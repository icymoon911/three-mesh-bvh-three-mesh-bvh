/** @import { Object3D, Frustum } from 'three' */
/** @import { IntersectsBoundsCallback, IntersectsRangeCallback, BoundsTraverseOrderCallback } from './BVH.js' */
import { Box3, BufferGeometry, Matrix4, Mesh, Vector3, Ray, Sphere, Frustum } from 'three';
import { BVH } from './BVH.js';
import { INTERSECTED, NOT_INTERSECTED, CONTAINED } from './Constants.js';
import { OrientedBox } from '../math/OrientedBox.js';

const _geometry = /* @__PURE__ */ new BufferGeometry();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box = /* @__PURE__ */ new Box3();
const _sphere = /* @__PURE__ */ new Sphere();
const _vec = /* @__PURE__ */ new Vector3();
const _ray = /* @__PURE__ */ new Ray();
const _mesh = /* @__PURE__ */ new Mesh();
const _geometryRange = {};

// scratch variables for collection methods
const _obb = /* @__PURE__ */ new OrientedBox();
const _box2 = /* @__PURE__ */ new Box3();
const _point = /* @__PURE__ */ new Vector3();
const _invMatrixWorld = /* @__PURE__ */ new Matrix4();
const _frustum = /* @__PURE__ */ new Frustum();

/**
 * @callback IntersectsObjectCallback
 * @param {Object3D} object - The scene object whose bounds were intersected.
 * @param {number} instanceId - Instance index for InstancedMesh/BatchedMesh, or 0 for regular objects.
 * @param {boolean} contained - Whether the node bounds are fully contained by the query shape.
 * @param {number} depth - The depth of the node in the tree.
 * @returns {boolean} Return `true` to stop traversal.
 */

/**
 * BVH built from a scene hierarchy rather than a single geometry. Each leaf holds
 * one Object3D (or one instance of an InstancedMesh/BatchedMesh), enabling
 * accelerated raycasting and spatial queries across many objects at once.
 *
 * @param {Object3D | Array<Object3D>} root - Root object or array of objects.
 * @param {Object} [options] - Accepts all standard BVH options plus:
 * @param {boolean} [options.precise=false] - Use vertex-level bounds instead of cached bounding boxes.
 * @param {boolean} [options.includeInstances=true] - Treat each instance of InstancedMesh/BatchedMesh as a separate primitive.
 * @extends BVH
 */
export class ObjectBVH extends BVH {

	constructor( root, options = {} ) {

		options = {
			precise: false,
			includeInstances: true,
			matrixWorld: Array.isArray( root ) ? new Matrix4() : root.matrixWorld,
			maxLeafSize: 1,
			...options,
		};

		super();

		// collect all the leaf node objects in the geometries
		const objectSet = new Set();
		collectObjects( root, objectSet );

		// calculate the number of bits required for the primary id, leaving the remainder
		// for the instanceId count
		const objects = Array.from( objectSet );
		const idBits = Math.ceil( Math.log2( objects.length ) );
		const idMask = constructIdMask( idBits );

		this.objects = objects;
		this.idBits = idBits;
		this.idMask = idMask;
		this.primitiveBuffer = null;
		this.primitiveBufferStride = 1;

		// settings
		this.precise = options.precise;
		this.includeInstances = options.includeInstances;
		this.matrixWorld = options.matrixWorld;

		this.init( options );

	}

	/**
	 * Returns the `Object3D` associated with a composite id as provided to `intersectsObject`.
	 * @param {number} compositeId
	 * @returns {Object3D}
	 */
	getObjectFromId( compositeId ) {

		const { idMask, objects } = this;
		const id = getObjectId( compositeId, idMask );
		return objects[ id ];

	}

	/**
	 * Returns the instance index associated with a composite id as provided to `intersectsObject`.
	 * @param {number} compositeId
	 * @returns {number}
	 */
	getInstanceFromId( compositeId ) {

		const { idMask, idBits } = this;
		return getInstanceId( compositeId, idBits, idMask );

	}

	init( options ) {

		const { objects, idBits } = this;
		this.primitiveBuffer = new Uint32Array( this._countPrimitives( objects ) );
		this._fillPrimitiveBuffer( objects, idBits, this.primitiveBuffer );

		super.init( options );

	}

	writePrimitiveBounds( i, targetBuffer, writeOffset ) {

		// TODO: it would be best to cache this matrix inversion
		const { primitiveBuffer } = this;
		_inverseMatrix.copy( this.matrixWorld ).invert();

		this._getPrimitiveBoundingBox( primitiveBuffer[ i ], _inverseMatrix, _box );
		const { min, max } = _box;

		targetBuffer[ writeOffset + 0 ] = min.x;
		targetBuffer[ writeOffset + 1 ] = min.y;
		targetBuffer[ writeOffset + 2 ] = min.z;
		targetBuffer[ writeOffset + 3 ] = max.x;
		targetBuffer[ writeOffset + 4 ] = max.y;
		targetBuffer[ writeOffset + 5 ] = max.z;

	}

	getRootRanges() {

		return [ { offset: 0, count: this.primitiveBuffer.length } ];

	}

	/**
	 * Performs a spatial query against the BVH. Extends the base `shapecast` with an
	 * `intersectsObject` callback that is called once per object primitive in leaf nodes.
	 *
	 * @param {Object} callbacks
	 * @param {IntersectsBoundsCallback} callbacks.intersectsBounds
	 * @param {IntersectsObjectCallback} [callbacks.intersectsObject]
	 * @param {IntersectsRangeCallback} [callbacks.intersectsRange]
	 * @param {BoundsTraverseOrderCallback} [callbacks.boundsTraverseOrder]
	 * @returns {boolean}
	 */
	shapecast( callbacks ) {

		return super.shapecast( {
			...callbacks,

			intersectsPrimitive: callbacks.intersectsObject,
			scratchPrimitive: null,
			iterate: iterateOverObjects,
		} );

	}

	/**
	 * Collects all objects whose bounding boxes intersect the given axis-aligned box.
	 *
	 * When a BVH node is fully contained by the query box the entire subtree is collected
	 * without further per-object tests (CONTAINED short-circuit). Otherwise each object's
	 * own bounding box is tested against the oriented query box for precision.
	 *
	 * @param {Box3} box - The query box.
	 * @param {Matrix4} [boxToBvh] - Transform from box-space into the BVH local frame.
	 *   If omitted the box is assumed to already be in BVH-local space (identity).
	 * @param {Array<Object>} [results=[]] - Array to append results to. Each entry is
	 *   `{ object, instanceId, contained }`.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false] - Include objects with `visible === false`.
	 * @returns {Array<Object>} The `results` array.
	 */
	collectObjectsInBox( box, boxToBvh, results = [], options = {} ) {

		const { includeHidden = false } = options;
		const { primitiveBuffer, objects, idMask, idBits, matrixWorld } = this;

		// set up the oriented query box
		if ( boxToBvh ) {

			_obb.set( box.min, box.max, boxToBvh );

		} else {

			_obb.set( box.min, box.max, new Matrix4() );

		}

		_obb.needsUpdate = true;

		// inverse of the OBB matrix, for containment tests (available after first intersectsBox call)
		_invMatrixWorld.copy( matrixWorld ).invert();

		this.shapecast( {
			intersectsBounds: nodeBox => {

				if ( ! _obb.intersectsBox( nodeBox ) ) return NOT_INTERSECTED;

				// containment: transform AABB corners into OBB local space
				const { min, max } = nodeBox;
				for ( let x = 0; x < 2; x ++ ) {

					for ( let y = 0; y < 2; y ++ ) {

						for ( let z = 0; z < 2; z ++ ) {

							_point.set(
								x ? max.x : min.x,
								y ? max.y : min.y,
								z ? max.z : min.z
							);
							_point.applyMatrix4( _obb.invMatrix );
							if (
								_point.x < _obb.min.x || _point.x > _obb.max.x ||
								_point.y < _obb.min.y || _point.y > _obb.max.y ||
								_point.z < _obb.min.z || _point.z > _obb.max.z
							) {

								return INTERSECTED;

							}

						}

					}

				}

				return CONTAINED;

			},
			intersectsRange: ( offset, count, contained ) => {

				for ( let i = offset, l = offset + count; i < l; i ++ ) {

					const compositeId = primitiveBuffer[ i ];
					const id = getObjectId( compositeId, idMask );
					const instanceId = getInstanceId( compositeId, idBits, idMask );
					const object = objects[ id ];

					if ( ! includeHidden && isObjectHidden( object, instanceId ) ) continue;

					if ( contained ) {

						results.push( { object, instanceId, contained: true } );

					} else {

						this._getPrimitiveBoundingBox( compositeId, _invMatrixWorld, _box2 );
						if ( _obb.intersectsBox( _box2 ) ) {

							results.push( { object, instanceId, contained: false } );

						}

					}

				}

				return false;

			},
		} );

		return results;

	}

	/**
	 * Collects all objects whose bounding boxes intersect the given sphere.
	 *
	 * The sphere is expected to be in the local space of the BVH.
	 *
	 * @param {Sphere} sphere - The query sphere.
	 * @param {Array<Object>} [results=[]] - Array to append results to.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false]
	 * @returns {Array<Object>} The `results` array.
	 */
	collectObjectsInSphere( sphere, results = [], options = {} ) {

		const { includeHidden = false } = options;
		const { primitiveBuffer, objects, idMask, idBits, matrixWorld } = this;

		_invMatrixWorld.copy( matrixWorld ).invert();

		this.shapecast( {
			intersectsBounds: nodeBox => {

				if ( ! sphere.intersectsBox( nodeBox ) ) return NOT_INTERSECTED;
				if ( sphereContainsBox( sphere, nodeBox ) ) return CONTAINED;
				return INTERSECTED;

			},
			intersectsRange: ( offset, count, contained ) => {

				for ( let i = offset, l = offset + count; i < l; i ++ ) {

					const compositeId = primitiveBuffer[ i ];
					const id = getObjectId( compositeId, idMask );
					const instanceId = getInstanceId( compositeId, idBits, idMask );
					const object = objects[ id ];

					if ( ! includeHidden && isObjectHidden( object, instanceId ) ) continue;

					if ( contained ) {

						results.push( { object, instanceId, contained: true } );

					} else {

						this._getPrimitiveBoundingBox( compositeId, _invMatrixWorld, _box2 );
						if ( sphere.intersectsBox( _box2 ) ) {

							results.push( { object, instanceId, contained: false } );

						}

					}

				}

				return false;

			},
		} );

		return results;

	}

	/**
	 * Collects all objects whose bounding boxes intersect the given frustum. Useful for
	 * frustum culling scenarios. When a BVH node is fully contained by the frustum the
	 * entire subtree is collected without per-object tests.
	 *
	 * @param {Frustum} frustum - The query frustum.
	 * @param {Matrix4} [frustumToBvh] - Transform from the frustum's coordinate space into
	 *   the BVH local frame. If omitted the frustum is assumed to already be in BVH-local space.
	 * @param {Array<Object>} [results=[]] - Array to append results to.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false]
	 * @returns {Array<Object>} The `results` array.
	 */
	collectObjectsInFrustum( frustum, frustumToBvh, results = [], options = {} ) {

		const { includeHidden = false } = options;
		const { primitiveBuffer, objects, idMask, idBits, matrixWorld } = this;

		// transform frustum planes into BVH-local space if a transform is provided
		let testFrustum;
		if ( frustumToBvh ) {

			for ( let i = 0; i < 6; i ++ ) {

				_frustum.planes[ i ].copy( frustum.planes[ i ] ).applyMatrix4( frustumToBvh );

			}

			testFrustum = _frustum;

		} else {

			testFrustum = frustum;

		}

		_invMatrixWorld.copy( matrixWorld ).invert();

		this.shapecast( {
			intersectsBounds: nodeBox => {

				if ( ! testFrustum.intersectsBox( nodeBox ) ) return NOT_INTERSECTED;
				if ( frustumContainsBox( testFrustum, nodeBox ) ) return CONTAINED;
				return INTERSECTED;

			},
			intersectsRange: ( offset, count, contained ) => {

				for ( let i = offset, l = offset + count; i < l; i ++ ) {

					const compositeId = primitiveBuffer[ i ];
					const id = getObjectId( compositeId, idMask );
					const instanceId = getInstanceId( compositeId, idBits, idMask );
					const object = objects[ id ];

					if ( ! includeHidden && isObjectHidden( object, instanceId ) ) continue;

					if ( contained ) {

						results.push( { object, instanceId, contained: true } );

					} else {

						this._getPrimitiveBoundingBox( compositeId, _invMatrixWorld, _box2 );
						if ( testFrustum.intersectsBox( _box2 ) ) {

							results.push( { object, instanceId, contained: false } );

						}

					}

				}

				return false;

			},
		} );

		return results;

	}

	/**
	 * Batch query: collects objects matching one or more shapes in a single BVH traversal.
	 *
	 * Each entry in `shapes` is a descriptor object:
	 * - `{ type: 'box',    shape: Box3,    matrix: Matrix4 }` — box with optional boxToBvh transform
	 * - `{ type: 'sphere', shape: Sphere }` — sphere in BVH-local space
	 * - `{ type: 'frustum', shape: Frustum, matrix: Matrix4 }` — frustum with optional frustumToBvh transform
	 *
	 * Result entries include a `shapeIndex` field indicating which shape produced the hit.
	 *
	 * @param {Array<Object>} shapes - Array of shape descriptors.
	 * @param {Array<Object>} [results=[]] - Array to append results to. Each entry is
	 *   `{ object, instanceId, contained, shapeIndex }`.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false]
	 * @returns {Array<Object>} The `results` array.
	 */
	collectObjectsInShapes( shapes, results = [], options = {} ) {

		const { includeHidden = false } = options;
		const { primitiveBuffer, objects, idMask, idBits, matrixWorld } = this;

		// pre-process shapes into tester objects
		const testers = shapes.map( ( desc, idx ) => prepareShapeTester( desc, idx ) );

		_invMatrixWorld.copy( matrixWorld ).invert();

		this.shapecast( {
			intersectsBounds: nodeBox => {

				// always test ALL shapes so lastBoundsResult stays fresh for every tester
				let best = NOT_INTERSECTED;
				for ( let s = 0, sl = testers.length; s < sl; s ++ ) {

					const r = testers[ s ].testBounds( nodeBox );
					if ( r > best ) best = r;

				}

				return best;

			},
			intersectsRange: ( offset, count, contained ) => {

				let objBoxComputed = false;

				for ( let i = offset, l = offset + count; i < l; i ++ ) {

					const compositeId = primitiveBuffer[ i ];
					const id = getObjectId( compositeId, idMask );
					const instanceId = getInstanceId( compositeId, idBits, idMask );
					const object = objects[ id ];

					if ( ! includeHidden && isObjectHidden( object, instanceId ) ) continue;

					if ( contained ) {

						for ( let s = 0, sl = testers.length; s < sl; s ++ ) {

							if ( testers[ s ].lastBoundsResult === CONTAINED ) {

								results.push( { object, instanceId, contained: true, shapeIndex: testers[ s ].index } );

							} else if ( testers[ s ].lastBoundsResult === INTERSECTED ) {

								// shape intersected but did not contain the node — do per-object test
								if ( ! objBoxComputed ) {

									this._getPrimitiveBoundingBox( compositeId, _invMatrixWorld, _box2 );
									objBoxComputed = true;

								}

								if ( testers[ s ].testObject( _box2 ) ) {

									results.push( { object, instanceId, contained: false, shapeIndex: testers[ s ].index } );

								}

							}

						}

					} else {

						if ( ! objBoxComputed ) {

							this._getPrimitiveBoundingBox( compositeId, _invMatrixWorld, _box2 );
							objBoxComputed = true;

						}

						for ( let s = 0, sl = testers.length; s < sl; s ++ ) {

							if ( testers[ s ].testObject( _box2 ) ) {

								results.push( { object, instanceId, contained: false, shapeIndex: testers[ s ].index } );

							}

						}

					}

				}

				return false;

			},
		} );

		return results;

	}

	// TODO: this is out of sync with the MeshBVH raycast signature.
	// Change this to "raycastObject3D"? Or add an equivalent?
	raycast( raycaster, intersects = [] ) {

		const { matrixWorld, includeInstances } = this;
		const { firstHitOnly } = raycaster;
		const localIntersects = [];

		// transform the ray into the local bvh frame
		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		let closestDistance = Infinity;
		let closestHit = null;

		this.shapecast( {
			boundsTraverseOrder: box => {

				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: box => {

				if ( firstHitOnly ) {

					if ( ! _ray.intersectBox( box, _vec ) ) {

						return NOT_INTERSECTED;

					}

					// early out if the box is further than the closest raycast
					_vec.applyMatrix4( matrixWorld );
					return raycaster.ray.origin.distanceTo( _vec ) < closestDistance ? INTERSECTED : NOT_INTERSECTED;

				} else {

					return _ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

				}

			},
			intersectsObject( object, instanceId ) {

				// skip non visible objects
				if ( ! object.visible ) {

					return;

				}

				localIntersects.length = 0;

				if ( object.isInstancedMesh && includeInstances ) {

					// raycast the instance
					_mesh.geometry = object.geometry;
					_mesh.material = object.material;

					object.getMatrixAt( instanceId, _mesh.matrixWorld );
					_mesh.matrixWorld.premultiply( object.matrixWorld );
					_mesh.raycast( raycaster, localIntersects );

					localIntersects.forEach( hit => {

						hit.object = object;
						hit.instanceId = instanceId;

					} );

					_mesh.material = null;

				} else if ( object.isBatchedMesh && includeInstances ) {

					if ( ! object.getVisibleAt( instanceId ) ) {

						return;

					}

					// extract the geometry & material
					const geometryId = object.getGeometryIdAt( instanceId );
					const geometryRange = object.getGeometryRangeAt( geometryId, _geometryRange );

					_geometry.index = object.geometry.index;
					_geometry.attributes = object.geometry.attributes;
					_geometry.setDrawRange( geometryRange.start, geometryRange.count );

					_mesh.geometry = _geometry;
					_mesh.material = object.material;

					// perform a raycast against the proxy mesh
					object.getMatrixAt( instanceId, _mesh.matrixWorld );
					_mesh.matrixWorld.premultiply( object.matrixWorld );
					_mesh.raycast( raycaster, localIntersects );

					// fix up the fields
					localIntersects.forEach( hit => {

						hit.object = object;
						hit.batchId = instanceId;

					} );

					_mesh.material = null;
					_geometry.index = null;
					_geometry.attributes = null;
					_geometry.setDrawRange( 0, Infinity );

				} else {

					object.raycast( raycaster, localIntersects );

				}

				// find the closest hit to track
				if ( firstHitOnly ) {

					localIntersects.forEach( hit => {

						if ( hit.distance < closestDistance ) {

							closestDistance = hit.distance;
							closestHit = hit;

						}

					} );

				} else {

					intersects.push( ...localIntersects );

				}

			},
		} );

		// save the closest hit only if firstHitOnly = true
		if ( firstHitOnly && closestHit ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

	// get the bounding box of a primitive node accounting for the bvh options
	_getPrimitiveBoundingBox( compositeId, inverseMatrixWorld, target ) {

		const { objects, idMask, idBits, precise, includeInstances } = this;
		const id = getObjectId( compositeId, idMask );
		const instanceId = getInstanceId( compositeId, idBits, idMask );
		const object = objects[ id ];

		if ( ! includeInstances && ( object.isInstancedMesh || object.isBatchedMesh ) ) {

			// if we're not using instances then just account for the overall bounds of the BatchedMesh and InstancedMesh
			if ( ! object.boundingBox ) {

				object.computeBoundingBox();

			}

			if ( ! object.boundingSphere ) {

				object.computeBoundingSphere();

			}

			_matrix
				.copy( object.matrixWorld )
				.premultiply( inverseMatrixWorld );

			_sphere
				.copy( object.boundingSphere )
				.applyMatrix4( _matrix );

			target
				.copy( object.boundingBox )
				.applyMatrix4( _matrix );

			shrinkToSphere( target, _sphere );

		} else if ( precise ) {

			// calculate precise bounds if necessary by calculating the bounds of all vertices
			// in the bvh frame
			if ( object.isInstancedMesh ) {

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				getPreciseBounds( object.geometry, _matrix, target );

			} else if ( object.isBatchedMesh ) {

				const geometryId = object.getGeometryIdAt( instanceId );
				const geometryRange = object.getGeometryRangeAt( geometryId, _geometryRange );

				_geometry.index = object.geometry.index;
				_geometry.attributes = object.geometry.attributes;
				_geometry.setDrawRange( geometryRange.start, geometryRange.count );

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				getPreciseBounds( _geometry, _matrix, target );

				_geometry.attributes = null;

			} else {

				_matrix
					.copy( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				target.setFromObject( object, true ).applyMatrix4( inverseMatrixWorld );

			}

		} else {

			// otherwise use the fast path of extracting the cached, AABB bounds and transforming them
			// into the local BVH frame
			if ( object.isInstancedMesh ) {

				if ( ! object.geometry.boundingBox ) {

					object.geometry.computeBoundingBox();

				}

				if ( ! object.geometry.boundingSphere ) {

					object.geometry.computeBoundingSphere();

				}

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				_sphere
					.copy( object.geometry.boundingSphere )
					.applyMatrix4( _matrix );

				target
					.copy( object.geometry.boundingBox )
					.applyMatrix4( _matrix );

				shrinkToSphere( target, _sphere );

			} else if ( object.isBatchedMesh ) {

				const geometryId = object.getGeometryIdAt( instanceId );

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				object
					.getBoundingSphereAt( geometryId, _sphere )
					.applyMatrix4( _matrix );

				object
					.getBoundingBoxAt( geometryId, target )
					.applyMatrix4( _matrix );

				shrinkToSphere( target, _sphere );

			} else {

				target
					.setFromObject( object, false )
					.applyMatrix4( inverseMatrixWorld );

			}

		}

	}

	// counts the total number of primitives required by the objects in given array of objects
	_countPrimitives( objects ) {

		const { includeInstances } = this;
		let total = 0;
		objects.forEach( object => {

			if ( object.isInstancedMesh && includeInstances ) {

				total += object.count;

			} else if ( object.isBatchedMesh && includeInstances ) {

				if ( ! ( 'instanceCount' in object ) ) {

					throw new Error( 'ObjectBVH: Three.js revision >= r169 is required to use BatchedMesh.' );

				}

				total += object.instanceCount;

			} else {

				total ++;

			}

		} );

		return total;

	}

	_fillPrimitiveBuffer( objects, idBits, target ) {

		const { includeInstances } = this;
		let index = 0;
		objects.forEach( ( object, i ) => {

			if ( object.isInstancedMesh && includeInstances ) {

				const count = object.count;
				for ( let c = 0; c < count; c ++ ) {

					target[ index ] = ( c << idBits ) | i;
					index ++;

				}

			} else if ( object.isBatchedMesh && includeInstances ) {

				const { instanceCount, maxInstanceCount } = object;
				let foundInstances = 0;
				let iter = 0;

				while ( foundInstances < instanceCount && iter < maxInstanceCount ) {

					// TODO: it would be better to have a consistent way of querying whether an
					// instance were active
					try {

						object.getVisibleAt( iter );

						target[ index ] = ( iter << idBits ) | i;
						foundInstances ++;
						index ++;

					} catch {

						//

					}

					iter ++;

				}

			} else {

				target[ index ] = i;
				index ++;

			}

		} );

	}

}

// id functions
// construct a mask with the given number of bits set to 1
function constructIdMask( idBits ) {

	let mask = 0;
	for ( let i = 0; i < idBits; i ++ ) {

		mask = mask << 1 | 1;

	}

	return mask;

}

// extract the primary object id given the provided mask
function getObjectId( id, idMask ) {

	return id & idMask;

}

// extract the instance id given the mask and number of bits to shift
function getInstanceId( id, idBits, idMask ) {

	return ( id & ( ~ idMask ) ) >> idBits;

}

// traverse the full scene and collect all leaves
function collectObjects( root, objectSet = new Set() ) {

	if ( Array.isArray( root ) ) {

		root.forEach( object => collectObjects( object, objectSet ) );

	} else {

		root.traverse( child => {

			if ( child.isMesh || child.isLine || child.isPoints ) {

				objectSet.add( child );

			}

		} );

	}

}

// calculate precise box bounds of the given geometry in the given frame
function getPreciseBounds( geometry, matrix, target ) {

	target.makeEmpty();

	const drawRange = geometry.drawRange;
	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	const start = drawRange.start;
	const vertCount = indexAttr ? indexAttr.count : posAttr.count;
	const count = Math.min( vertCount - start, drawRange.count );
	for ( let i = start, l = start + count; i < l; i ++ ) {

		let vi = i;
		if ( indexAttr ) {

			vi = indexAttr.getX( vi );

		}

		_vec.fromBufferAttribute( posAttr, vi ).applyMatrix4( matrix );
		target.expandByPoint( _vec );

	}

	return target;

}

// iterator helper for raycasting
function iterateOverObjects( offset, count, bvh, callback, contained, depth, /* scratch */ ) {

	const { primitiveBuffer, objects, idMask, idBits } = bvh;
	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const compositeId = primitiveBuffer[ i ];
		const id = getObjectId( compositeId, idMask );
		const instanceId = getInstanceId( compositeId, idBits, idMask );
		const object = objects[ id ];
		if ( callback( object, instanceId, contained, depth ) ) {

			return true;

		}

	}

	return false;

}

function shrinkToSphere( box, sphere ) {

	_vec.copy( sphere.center ).addScalar( - sphere.radius );
	box.min.max( _vec );

	_vec.copy( sphere.center ).addScalar( sphere.radius );
	box.max.min( _vec );

}

// returns true if the object (or batched instance) should be skipped due to visibility
function isObjectHidden( object, instanceId ) {

	if ( ! object.visible ) return true;
	if ( object.isBatchedMesh && ! object.getVisibleAt( instanceId ) ) return true;
	return false;

}

// returns true if every corner of the AABB lies within the sphere
function sphereContainsBox( sphere, box ) {

	const r2 = sphere.radius * sphere.radius;
	const cx = sphere.center.x, cy = sphere.center.y, cz = sphere.center.z;
	const { min, max } = box;
	for ( let x = 0; x < 2; x ++ ) {

		const px = x ? max.x : min.x;
		for ( let y = 0; y < 2; y ++ ) {

			const py = y ? max.y : min.y;
			for ( let z = 0; z < 2; z ++ ) {

				const pz = z ? max.z : min.z;
				const dx = px - cx, dy = py - cy, dz = pz - cz;
				if ( dx * dx + dy * dy + dz * dz > r2 ) return false;

			}

		}

	}

	return true;

}

// returns true if every corner of the AABB lies inside the frustum
function frustumContainsBox( frustum, box ) {

	const { min, max } = box;
	for ( let x = 0; x < 2; x ++ ) {

		for ( let y = 0; y < 2; y ++ ) {

			for ( let z = 0; z < 2; z ++ ) {

				_point.set(
					x ? max.x : min.x,
					y ? max.y : min.y,
					z ? max.z : min.z
				);
				if ( ! frustum.containsPoint( _point ) ) return false;

			}

		}

	}

	return true;

}

// build a tester object for the batch collectObjectsInShapes API
function prepareShapeTester( desc, index ) {

	const { type, shape, matrix } = desc;

	if ( type === 'box' ) {

		if ( matrix ) {

			_obb.set( shape.min, shape.max, matrix );

		} else {

			_obb.set( shape.min, shape.max, new Matrix4() );

		}

		_obb.needsUpdate = true;
		// snapshot the OBB state so multiple testers don't clobber each other
		const obb = new OrientedBox( shape.min, shape.max, matrix || new Matrix4() );
		obb.needsUpdate = true;
		obb.update();

		return {
			index,
			lastBoundsResult: NOT_INTERSECTED,
			testBounds( nodeBox ) {

				const r = obb.intersectsBox( nodeBox ) ?
					( obbContainsBox( obb, nodeBox ) ? CONTAINED : INTERSECTED ) :
					NOT_INTERSECTED;
				this.lastBoundsResult = r;
				return r;

			},
			testObject( objBox ) {

				return obb.intersectsBox( objBox );

			},
		};

	} else if ( type === 'sphere' ) {

		return {
			index,
			lastBoundsResult: NOT_INTERSECTED,
			testBounds( nodeBox ) {

				const r = shape.intersectsBox( nodeBox ) ?
					( sphereContainsBox( shape, nodeBox ) ? CONTAINED : INTERSECTED ) :
					NOT_INTERSECTED;
				this.lastBoundsResult = r;
				return r;

			},
			testObject( objBox ) {

				return shape.intersectsBox( objBox );

			},
		};

	} else if ( type === 'frustum' ) {

		// build a local-space frustum
		const localFrustum = new Frustum();
		if ( matrix ) {

			for ( let i = 0; i < 6; i ++ ) {

				localFrustum.planes[ i ].copy( shape.planes[ i ] ).applyMatrix4( matrix );

			}

		} else {

			for ( let i = 0; i < 6; i ++ ) {

				localFrustum.planes[ i ].copy( shape.planes[ i ] );

			}

		}

		return {
			index,
			lastBoundsResult: NOT_INTERSECTED,
			testBounds( nodeBox ) {

				const r = localFrustum.intersectsBox( nodeBox ) ?
					( frustumContainsBox( localFrustum, nodeBox ) ? CONTAINED : INTERSECTED ) :
					NOT_INTERSECTED;
				this.lastBoundsResult = r;
				return r;

			},
			testObject( objBox ) {

				return localFrustum.intersectsBox( objBox );

			},
		};

	}

	throw new Error( `ObjectBVH.collectObjectsInShapes: unknown shape type "${ type }"` );

}

// returns true if every corner of the given AABB is inside the OBB
function obbContainsBox( obb, box ) {

	const { min, max } = box;
	const obbMin = obb.min, obbMax = obb.max;
	const invMat = obb.invMatrix;
	for ( let x = 0; x < 2; x ++ ) {

		for ( let y = 0; y < 2; y ++ ) {

			for ( let z = 0; z < 2; z ++ ) {

				_point.set(
					x ? max.x : min.x,
					y ? max.y : min.y,
					z ? max.z : min.z
				);
				_point.applyMatrix4( invMat );
				if (
					_point.x < obbMin.x || _point.x > obbMax.x ||
					_point.y < obbMin.y || _point.y > obbMax.y ||
					_point.z < obbMin.z || _point.z > obbMax.z
				) {

					return false;

				}

			}

		}

	}

	return true;

}
