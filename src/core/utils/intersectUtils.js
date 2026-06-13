
export function intersectsNodeBounds( nodeIndex32, array, ray, near, far ) {

	// This function performs intersection tests similar to Ray.intersectBox in three.js,
	// with the difference that the box values are read from an array to improve performance.

	let tmin, tmax, tymin, tymax, tzmin, tzmax;

	const invdirx = 1 / ray.direction.x,
		invdiry = 1 / ray.direction.y,
		invdirz = 1 / ray.direction.z;

	const ox = ray.origin.x;
	const oy = ray.origin.y;
	const oz = ray.origin.z;

	let minx = array[ nodeIndex32 ];
	let maxx = array[ nodeIndex32 + 3 ];

	let miny = array[ nodeIndex32 + 1 ];
	let maxy = array[ nodeIndex32 + 3 + 1 ];

	let minz = array[ nodeIndex32 + 2 ];
	let maxz = array[ nodeIndex32 + 3 + 2 ];

	if ( invdirx >= 0 ) {

		tmin = ( minx - ox ) * invdirx;
		tmax = ( maxx - ox ) * invdirx;

	} else {

		tmin = ( maxx - ox ) * invdirx;
		tmax = ( minx - ox ) * invdirx;

	}

	if ( invdiry >= 0 ) {

		tymin = ( miny - oy ) * invdiry;
		tymax = ( maxy - oy ) * invdiry;

	} else {

		tymin = ( maxy - oy ) * invdiry;
		tymax = ( miny - oy ) * invdiry;

	}

	// Apply a relative epsilon to the slab comparisons to avoid missing
	// intersections when the ray is nearly parallel to a bounding box face.
	// Without this tolerance, floating-point rounding can cause tmin to
	// exceed tmax (or tymin/tzmin to exceed tmax) by a tiny amount even
	// when the ray genuinely intersects the box.
	const eps_tmax = Math.max( Math.abs( tmax ), 1.0 ) * 1e-7;
	const eps_tymax = Math.max( Math.abs( tymax ), 1.0 ) * 1e-7;

	if ( ( tmin > tymax + eps_tymax ) || ( tymin > tmax + eps_tmax ) ) return false;

	if ( tymin > tmin || isNaN( tmin ) ) tmin = tymin;

	if ( tymax < tmax || isNaN( tmax ) ) tmax = tymax;

	if ( invdirz >= 0 ) {

		tzmin = ( minz - oz ) * invdirz;
		tzmax = ( maxz - oz ) * invdirz;

	} else {

		tzmin = ( maxz - oz ) * invdirz;
		tzmax = ( minz - oz ) * invdirz;

	}

	const eps_tzmax = Math.max( Math.abs( tzmax ), 1.0 ) * 1e-7;

	if ( ( tmin > tzmax + eps_tzmax ) || ( tzmin > tmax + eps_tmax ) ) return false;

	if ( tzmin > tmin || tmin !== tmin ) tmin = tzmin;

	if ( tzmax < tmax || tmax !== tmax ) tmax = tzmax;

	//return point closest to the ray (positive side)

	return tmin <= far && tmax >= near;

}
