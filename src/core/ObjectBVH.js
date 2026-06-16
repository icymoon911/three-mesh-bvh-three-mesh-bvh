/** @import { Object3D } from 'three' */
/** @import { IntersectsBoundsCallback, IntersectsRangeCallback, BoundsTraverseOrderCallback } from './BVH.js' */
import { Box3, BufferGeometry, Frustum, Matrix4, Mesh, Vector3, Ray, Sphere } from 'three';
import { BVH } from './BVH.js';
import { CONTAINED, INTERSECTED, NOT_INTERSECTED } from './Constants.js';
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
const _obb = /* @__PURE__ */ new OrientedBox();
const _corner = /* @__PURE__ */ new Vector3();
const _collectFrustum = /* @__PURE__ */ new Frustum();

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

	/**
	 * Collects all objects whose bounding boxes intersect the given oriented bounding box (OBB).
	 * When a BVH node is fully contained by the query box, all objects in that subtree are collected
	 * without per-object intersection tests (CONTAINED short-circuit).
	 *
	 * The `boxToBvh` matrix transforms the query box into the BVH's local space.
	 *
	 * @param {Box3} box - The query box.
	 * @param {Matrix4} boxToBvh - Transform of the box into the local space of this BVH.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false] - Include objects with `visible === false`.
	 * @param {Array<Object>} [results=[]] - Array to collect results into (reduces GC pressure).
	 * @returns {Array<{object: Object3D, instanceId: number, contained: boolean}>}
	 */
	collectObjectsInBox( box, boxToBvh, options = {}, results = [] ) {

		const includeHidden = options.includeHidden || false;
		const { primitiveBuffer, objects, idMask, idBits } = this;

		_obb.set( box.min, box.max, boxToBvh );
		_obb.needsUpdate = true;

		_inverseMatrix.copy( this.matrixWorld ).invert();

		this.shapecast( {
			intersectsBounds: nodeBox => {

				if ( ! _obb.intersectsBox( nodeBox ) ) return NOT_INTERSECTED;
				if ( obbContainsBox( _obb, nodeBox ) ) return CONTAINED;
				return INTERSECTED;

			},
			intersectsRange: ( offset, count, contained ) => {

				for ( let i = offset, end = offset + count; i < end; i ++ ) {

					const compositeId = primitiveBuffer[ i ];
					const id = getObjectId( compositeId, idMask );
					const instanceId = getInstanceId( compositeId, idBits, idMask );
					const object = objects[ id ];

					if ( ! includeHidden && ! object.visible ) continue;

					if ( contained ) {

						results.push( { object, instanceId, contained: true } );

					} else {

						this._getPrimitiveBoundingBox( compositeId, _inverseMatrix, _box );
						if ( _obb.intersectsBox( _box ) ) {

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
	 * The sphere is expected to be in the BVH's local space. When a BVH node is fully
	 * contained by the sphere, all objects in that subtree are collected without per-object
	 * intersection tests (CONTAINED short-circuit).
	 *
	 * @param {Sphere} sphere - The query sphere in BVH local space.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false] - Include objects with `visible === false`.
	 * @param {Array<Object>} [results=[]] - Array to collect results into.
	 * @returns {Array<{object: Object3D, instanceId: number, contained: boolean}>}
	 */
	collectObjectsInSphere( sphere, options = {}, results = [] ) {

		const includeHidden = options.includeHidden || false;
		const { primitiveBuffer, objects, idMask, idBits } = this;

		_inverseMatrix.copy( this.matrixWorld ).invert();

		this.shapecast( {
			intersectsBounds: nodeBox => {

				if ( ! sphere.intersectsBox( nodeBox ) ) return NOT_INTERSECTED;
				if ( sphereContainsBox( sphere, nodeBox ) ) return CONTAINED;
				return INTERSECTED;

			},
			intersectsRange: ( offset, count, contained ) => {

				for ( let i = offset, end = offset + count; i < end; i ++ ) {

					const compositeId = primitiveBuffer[ i ];
					const id = getObjectId( compositeId, idMask );
					const instanceId = getInstanceId( compositeId, idBits, idMask );
					const object = objects[ id ];

					if ( ! includeHidden && ! object.visible ) continue;

					if ( contained ) {

						results.push( { object, instanceId, contained: true } );

					} else {

						this._getPrimitiveBoundingBox( compositeId, _inverseMatrix, _box );
						if ( sphere.intersectsBox( _box ) ) {

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
	 * Collects all objects that lie within the given frustum. Primarily useful for frustum
	 * culling in large scenes. When a BVH node is fully contained by the frustum, all objects
	 * in that subtree are collected without per-object intersection tests (CONTAINED short-circuit).
	 *
	 * The optional `frustumToBvh` matrix transforms the frustum into the BVH's local space
	 * (e.g. the inverse of the BVH's world matrix). If omitted, the frustum is assumed to
	 * already be in BVH local space.
	 *
	 * @param {Frustum} frustum - The query frustum.
	 * @param {Matrix4} [frustumToBvh=null] - Optional transform of the frustum into BVH local space.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false] - Include objects with `visible === false`.
	 * @param {Array<Object>} [results=[]] - Array to collect results into.
	 * @returns {Array<{object: Object3D, instanceId: number, contained: boolean}>}
	 */
	collectObjectsInFrustum( frustum, frustumToBvh = null, options = {}, results = [] ) {

		const includeHidden = options.includeHidden || false;
		const { primitiveBuffer, objects, idMask, idBits } = this;

		// Transform frustum into BVH local space if a matrix is provided
		let queryFrustum = frustum;
		if ( frustumToBvh ) {

			const planes = _collectFrustum.planes;
			const srcPlanes = frustum.planes;
			for ( let i = 0; i < 6; i ++ ) {

				planes[ i ].copy( srcPlanes[ i ] ).applyMatrix4( frustumToBvh );

			}

			queryFrustum = _collectFrustum;

		}

		_inverseMatrix.copy( this.matrixWorld ).invert();

		this.shapecast( {
			intersectsBounds: nodeBox => {

				if ( ! queryFrustum.intersectsBox( nodeBox ) ) return NOT_INTERSECTED;
				if ( frustumContainsBox( queryFrustum, nodeBox ) ) return CONTAINED;
				return INTERSECTED;

			},
			intersectsRange: ( offset, count, contained ) => {

				for ( let i = offset, end = offset + count; i < end; i ++ ) {

					const compositeId = primitiveBuffer[ i ];
					const id = getObjectId( compositeId, idMask );
					const instanceId = getInstanceId( compositeId, idBits, idMask );
					const object = objects[ id ];

					if ( ! includeHidden && ! object.visible ) continue;

					if ( contained ) {

						results.push( { object, instanceId, contained: true } );

					} else {

						this._getPrimitiveBoundingBox( compositeId, _inverseMatrix, _box );
						if ( queryFrustum.intersectsBox( _box ) ) {

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
	 * Batch query interface — collects objects matching any of the provided shapes in a
	 * convenient single call. Each shape descriptor must have a `type` field (`'box'`, `'sphere'`,
	 * or `'frustum'`) along with the corresponding shape data:
	 *
	 * - `{ type: 'box', box: Box3, boxToBvh: Matrix4 }`
	 * - `{ type: 'sphere', sphere: Sphere }`
	 * - `{ type: 'frustum', frustum: Frustum, frustumToBvh?: Matrix4 }`
	 *
	 * Objects that intersect multiple shapes are included only once (first shape wins).
	 * Each result entry has an additional `shapeIndex` field indicating which shape matched.
	 *
	 * @param {Array<Object>} shapes - Array of shape descriptors.
	 * @param {Object} [options]
	 * @param {boolean} [options.includeHidden=false] - Include objects with `visible === false`.
	 * @param {Array<Object>} [results=[]] - Array to collect results into.
	 * @returns {Array<{object: Object3D, instanceId: number, contained: boolean, shapeIndex: number}>}
	 */
	collectObjectsInShapes( shapes, options = {}, results = [] ) {

		const seen = new Set();

		for ( let i = 0, l = shapes.length; i < l; i ++ ) {

			const shape = shapes[ i ];
			const shapeResults = [];

			switch ( shape.type ) {

				case 'box':
					this.collectObjectsInBox( shape.box, shape.boxToBvh, options, shapeResults );
					break;

				case 'sphere':
					this.collectObjectsInSphere( shape.sphere, options, shapeResults );
					break;

				case 'frustum':
					this.collectObjectsInFrustum( shape.frustum, shape.frustumToBvh || null, options, shapeResults );
					break;

				default:
					console.warn( `ObjectBVH.collectObjectsInShapes: Unknown shape type "${ shape.type }" at index ${ i }.` );
					continue;

			}

			// Deduplicate: only include objects not already collected by a previous shape
			for ( let j = 0, jl = shapeResults.length; j < jl; j ++ ) {

				const r = shapeResults[ j ];
				const key = r.object.uuid + ':' + r.instanceId;
				if ( ! seen.has( key ) ) {

					seen.add( key );
					r.shapeIndex = i;
					results.push( r );

				}

			}

		}

		return results;

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

// Helper: check if an OBB fully contains an AABB.
// Requires obb.update() to have been called (i.e. obb.needsUpdate === false).
function obbContainsBox( obb, box ) {

	const invMatrix = obb.invMatrix;
	const obbMin = obb.min;
	const obbMax = obb.max;
	const bMin = box.min;
	const bMax = box.max;

	for ( let x = 0; x <= 1; x ++ ) {

		for ( let y = 0; y <= 1; y ++ ) {

			for ( let z = 0; z <= 1; z ++ ) {

				_corner.set(
					x ? bMax.x : bMin.x,
					y ? bMax.y : bMin.y,
					z ? bMax.z : bMin.z
				).applyMatrix4( invMatrix );

				if ( _corner.x < obbMin.x || _corner.x > obbMax.x ||
					_corner.y < obbMin.y || _corner.y > obbMax.y ||
					_corner.z < obbMin.z || _corner.z > obbMax.z ) {

					return false;

				}

			}

		}

	}

	return true;

}

// Helper: check if a sphere fully contains an AABB.
function sphereContainsBox( sphere, box ) {

	const center = sphere.center;
	const r = sphere.radius;
	const rSq = r * r;
	const bMin = box.min;
	const bMax = box.max;

	for ( let x = 0; x <= 1; x ++ ) {

		for ( let y = 0; y <= 1; y ++ ) {

			for ( let z = 0; z <= 1; z ++ ) {

				const cx = x ? bMax.x : bMin.x;
				const cy = y ? bMax.y : bMin.y;
				const cz = z ? bMax.z : bMin.z;
				const dx = cx - center.x;
				const dy = cy - center.y;
				const dz = cz - center.z;
				if ( dx * dx + dy * dy + dz * dz > rSq ) return false;

			}

		}

	}

	return true;

}

// Helper: check if a frustum fully contains an AABB.
function frustumContainsBox( frustum, box ) {

	const planes = frustum.planes;
	const bMin = box.min;
	const bMax = box.max;

	for ( let x = 0; x <= 1; x ++ ) {

		for ( let y = 0; y <= 1; y ++ ) {

			for ( let z = 0; z <= 1; z ++ ) {

				_corner.set(
					x ? bMax.x : bMin.x,
					y ? bMax.y : bMin.y,
					z ? bMax.z : bMin.z
				);

				for ( let p = 0; p < 6; p ++ ) {

					if ( planes[ p ].distanceToPoint( _corner ) < 0 ) return false;

				}

			}

		}

	}

	return true;

}
