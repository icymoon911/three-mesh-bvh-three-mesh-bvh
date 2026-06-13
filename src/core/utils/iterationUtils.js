import { intersectTri } from '../../utils/ThreeRayIntersectUtilities.js';
import { setTriangle } from '../../utils/TriangleUtilities.js';

export function intersectTris( bvh, materialOrSide, ray, offset, count, intersections, near, far ) {

	const { geometry } = bvh;
	const resolveIndex = bvh.resolvePrimitiveIndex;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		intersectTri( geometry, materialOrSide, ray, resolveIndex( i ), intersections, near, far );

	}

}

export function intersectClosestTri( bvh, materialOrSide, ray, offset, count, near, far ) {

	const { geometry } = bvh;
	const resolveIndex = bvh.resolvePrimitiveIndex;
	let dist = Infinity;
	let res = null;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		const intersection = intersectTri( geometry, materialOrSide, ray, resolveIndex( i ), null, near, far );
		if ( intersection && intersection.distance < dist ) {

			res = intersection;
			dist = intersection.distance;

		}

	}

	return res;

}

export function iterateOverTriangles(
	offset,
	count,
	bvh,
	intersectsTriangleFunc,
	contained,
	depth,
	triangle
) {

	const { geometry } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;
	const resolveIndex = bvh.resolvePrimitiveIndex;
	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const tri = resolveIndex( i );
		setTriangle( triangle, tri * 3, index, pos );
		triangle.needsUpdate = true;

		if ( intersectsTriangleFunc( triangle, tri, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
