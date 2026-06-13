/* eslint-disable indent */
import { Box3, Sphere, Ray, Vector3 } from 'three';
import { ExtendedTriangle } from '../../math/ExtendedTriangle.js';
import { setTriangle } from '../../utils/TriangleUtilities.js';
import { arrayToBox } from '../../utils/ArrayBoxUtilities.js';
import { COUNT, OFFSET, IS_LEAF, BOUNDING_DATA_INDEX, LEFT_NODE, RIGHT_NODE } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';

const boundingBox = /* @__PURE__ */ new Box3();
const triangle = /* @__PURE__ */ new ExtendedTriangle();
const tempSphere = /* @__PURE__ */ new Sphere();
const closestPoint = /* @__PURE__ */ new Vector3();
const triangleCenter = /* @__PURE__ */ new Vector3();

// Check if a triangle intersects a capsule (sphere swept along a line segment)
function triangleIntersectsCapsule( tri, ray, radius, near, far ) {

	// Get ray segment endpoints
	const rayLen = ray.direction.length();
	if ( rayLen === 0 ) return false;

	const invLen = 1 / rayLen;
	const tMin = near * invLen;
	const tMax = far * invLen;

	// Compute triangle center for quick rejection
	triangleCenter.copy( tri.a ).add( tri.b ).add( tri.c ).multiplyScalar( 1 / 3 );

	// Find closest point on ray segment to triangle center
	const rayStart = ray.origin;
	const rayEnd = closestPoint.copy( ray.direction ).multiplyScalar( tMax ).add( ray.origin );

	// Quick distance check using triangle center
	closestPoint.lerpVectors( rayStart, rayEnd, 0.5 );
	const centerDist = triangleCenter.distanceTo( closestPoint );
	const maxTriExtent = Math.max(
		tri.a.distanceTo( triangleCenter ),
		tri.b.distanceTo( triangleCenter ),
		tri.c.distanceTo( triangleCenter )
	);

	if ( centerDist > radius + maxTriExtent + 1.0 ) {

		return false;

	}

	// Detailed check: for each triangle vertex, check distance to ray segment
	// Also check if ray segment is close to any triangle edge
	const points = [ tri.a, tri.b, tri.c ];

	// Check distance from each triangle vertex to the ray line
	for ( let i = 0; i < 3; i ++ ) {

		const p = points[ i ];
		const t = p.clone().sub( rayStart ).dot( ray.direction ) * invLen * invLen;
		const clampedT = Math.max( tMin, Math.min( tMax, t ) );
		const pointOnRay = closestPoint.copy( ray.direction ).multiplyScalar( clampedT ).add( rayStart );
		if ( p.distanceTo( pointOnRay ) <= radius ) {

			return true;

		}

	}

	// Check distance from ray segment to triangle edges
	for ( let i = 0; i < 3; i ++ ) {

		const a = points[ i ];
		const b = points[ ( i + 1 ) % 3 ];

		// Sample points along the triangle edge
		for ( let t = 0; t <= 1; t += 0.25 ) {

			const edgePoint = closestPoint.lerpVectors( a, b, t );
			const rayT = edgePoint.clone().sub( rayStart ).dot( ray.direction ) * invLen * invLen;
			const clampedT = Math.max( tMin, Math.min( tMax, rayT ) );
			const pointOnRay = new Vector3().copy( ray.direction ).multiplyScalar( clampedT ).add( rayStart );

			if ( edgePoint.distanceTo( pointOnRay ) <= radius ) {

				return true;

			}

		}

	}

	// Check if the ray origin or endpoint is inside the triangle expanded by radius
	const triPlane = tri.plane;
	if ( triPlane ) {

		const dist = Math.abs( triPlane.distanceToPoint( rayStart ) );
		if ( dist <= radius ) {

			const projected = triPlane.projectPoint( rayStart, closestPoint );
			if ( tri.containsPoint( projected ) ) {

				const rayT = closestPoint.clone().sub( rayStart ).dot( ray.direction ) * invLen * invLen;
				if ( rayT >= tMin && rayT <= tMax ) return true;

			}

		}

	}

	return false;

}

export function sphereCast/* @echo INDIRECT_STRING */( bvh, root, sphere, ray, near, far, intersects ) {

	BufferStack.setBuffer( bvh._roots[ root ] );
	_sphereCast( 0, bvh, sphere, ray, near, far, intersects );
	BufferStack.clearBuffer();

	return intersects;

}

function _sphereCast( nodeIndex32, bvh, sphere, ray, near, far, intersects ) {

	const { float32Array, uint16Array, uint32Array } = BufferStack;
	let nodeIndex16 = nodeIndex32 * 2;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const thisGeometry = bvh.geometry;
		const thisIndex = thisGeometry.index;
		const thisPos = thisGeometry.attributes.position;

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		const radius = sphere.radius;

		/* @if INDIRECT */

		for ( let i = offset, l = count + offset; i < l; i ++ ) {

			const ti = bvh.resolveTriangleIndex( i );
			setTriangle( triangle, 3 * ti, thisIndex, thisPos );
			triangle.needsUpdate = true;

			if ( triangleIntersectsCapsule( triangle, ray, radius, near, far ) ) {

				// Compute approximate hit distance (distance from ray origin to triangle center)
				triangleCenter.copy( triangle.a ).add( triangle.b ).add( triangle.c ).multiplyScalar( 1 / 3 );
				const dx = triangleCenter.x - ray.origin.x;
				const dy = triangleCenter.y - ray.origin.y;
				const dz = triangleCenter.z - ray.origin.z;
				const distance = Math.sqrt( dx * dx + dy * dy + dz * dz );

				intersects.push( {
					triangleIndex: ti,
					distance: distance,
					point: new Vector3().copy( triangleCenter ),
				} );

			}

		}

		/* @else */

		for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

			setTriangle( triangle, i, thisIndex, thisPos );
			triangle.needsUpdate = true;

			if ( triangleIntersectsCapsule( triangle, ray, radius, near, far ) ) {

				const ti = i / 3;
				triangleCenter.copy( triangle.a ).add( triangle.b ).add( triangle.c ).multiplyScalar( 1 / 3 );
				const dx = triangleCenter.x - ray.origin.x;
				const dy = triangleCenter.y - ray.origin.y;
				const dz = triangleCenter.z - ray.origin.z;
				const distance = Math.sqrt( dx * dx + dy * dy + dz * dz );

				intersects.push( {
					triangleIndex: ti,
					distance: distance,
					point: new Vector3().copy( triangleCenter ),
				} );

			}

		}

		/* @endif */

	} else {

		const left = LEFT_NODE( nodeIndex32 );
		const right = RIGHT_NODE( nodeIndex32, uint32Array );

		// Expand bounding box by sphere radius for broad-phase
		arrayToBox( BOUNDING_DATA_INDEX( left ), float32Array, boundingBox );
		boundingBox.expandByScalar( sphere.radius );
		if ( ray.intersectsBox( boundingBox ) ) {

			_sphereCast( left, bvh, sphere, ray, near, far, intersects );

		}

		arrayToBox( BOUNDING_DATA_INDEX( right ), float32Array, boundingBox );
		boundingBox.expandByScalar( sphere.radius );
		if ( ray.intersectsBox( boundingBox ) ) {

			_sphereCast( right, bvh, sphere, ray, near, far, intersects );

		}

	}

}
