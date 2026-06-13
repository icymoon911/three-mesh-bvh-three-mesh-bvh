import { Box3, Vector3 } from 'three';

const _vec = /* @__PURE__ */ new Vector3();

/**
 * Represents a single node in the BVH tree. During construction this is an in-memory
 * tree node with explicit `left`/`right` children or `offset`/`count` for leaf nodes.
 * After packing into the BVH buffer layout, these fields are serialized and no longer
 * used at runtime — the buffer is traversed directly.
 *
 * Provides convenience methods for bounding-box queries that were previously scattered
 * as free functions in computeBoundsUtils, ArrayBoxUtilities, and the cast modules.
 */
export class BVHNode {

	constructor() {

		// internal nodes have boundingData, left, right, and splitAxis
		// leaf nodes have offset and count (referring to primitives in the mesh geometry)

		this.boundingData = new Float32Array( 6 );

	}

	/**
	 * Whether this node is a leaf (has primitives, no children).
	 * @returns {boolean}
	 */
	get isLeaf() {

		return 'count' in this;

	}

	/**
	 * Writes the node's bounding data into a `Box3` target.
	 * @param {Box3} [target=new Box3()]
	 * @returns {Box3}
	 */
	getBox( target = new Box3() ) {

		const d = this.boundingData;
		target.min.set( d[ 0 ], d[ 1 ], d[ 2 ] );
		target.max.set( d[ 3 ], d[ 4 ], d[ 5 ] );
		return target;

	}

	/**
	 * Returns the center of the node's bounding box.
	 * @param {Vector3} [target=new Vector3()]
	 * @returns {Vector3}
	 */
	getCenter( target = new Vector3() ) {

		const d = this.boundingData;
		target.set(
			( d[ 0 ] + d[ 3 ] ) * 0.5,
			( d[ 1 ] + d[ 4 ] ) * 0.5,
			( d[ 2 ] + d[ 5 ] ) * 0.5,
		);
		return target;

	}

	/**
	 * Returns the size (extents) of the node's bounding box.
	 * @param {Vector3} [target=new Vector3()]
	 * @returns {Vector3}
	 */
	getSize( target = new Vector3() ) {

		const d = this.boundingData;
		target.set(
			d[ 3 ] - d[ 0 ],
			d[ 4 ] - d[ 1 ],
			d[ 5 ] - d[ 2 ],
		);
		return target;

	}

	/**
	 * Returns the index of the longest edge axis (0=x, 1=y, 2=z) or -1 if the
	 * bounding box is degenerate.
	 * @returns {number}
	 */
	getLongestAxis() {

		const d = this.boundingData;
		const x = d[ 3 ] - d[ 0 ];
		const y = d[ 4 ] - d[ 1 ];
		const z = d[ 5 ] - d[ 2 ];

		let max = x;
		let axis = 0;
		if ( y > max ) {

			max = y;
			axis = 1;

		}

		if ( z > max ) {

			max = z;
			axis = 2;

		}

		return max <= 0 ? - 1 : axis;

	}

	/**
	 * Computes the surface area of the node's bounding box.
	 * @returns {number}
	 */
	surfaceArea() {

		const d = this.boundingData;
		const x = d[ 3 ] - d[ 0 ];
		const y = d[ 4 ] - d[ 1 ];
		const z = d[ 5 ] - d[ 2 ];
		return 2 * ( x * y + x * z + y * z );

	}

	/**
	 * Tests whether a point lies within the node's bounding box.
	 * @param {Vector3} point
	 * @returns {boolean}
	 */
	containsPoint( point ) {

		const d = this.boundingData;
		return (
			point.x >= d[ 0 ] && point.x <= d[ 3 ] &&
			point.y >= d[ 1 ] && point.y <= d[ 4 ] &&
			point.z >= d[ 2 ] && point.z <= d[ 5 ]
		);

	}

	/**
	 * Tests whether this node's bounding box intersects the given Box3.
	 * @param {Box3} box
	 * @returns {boolean}
	 */
	intersectsBox( box ) {

		const d = this.boundingData;
		const bmin = box.min;
		const bmax = box.max;
		return ! (
			d[ 3 ] < bmin.x || d[ 0 ] > bmax.x ||
			d[ 4 ] < bmin.y || d[ 1 ] > bmax.y ||
			d[ 5 ] < bmin.z || d[ 2 ] > bmax.z
		);

	}

	/**
	 * Expands this node's bounding box to include another node's bounding box.
	 * @param {BVHNode} other
	 * @returns {BVHNode} this
	 */
	union( other ) {

		const a = this.boundingData;
		const b = other.boundingData;

		a[ 0 ] = Math.min( a[ 0 ], b[ 0 ] );
		a[ 1 ] = Math.min( a[ 1 ], b[ 1 ] );
		a[ 2 ] = Math.min( a[ 2 ], b[ 2 ] );

		a[ 3 ] = Math.max( a[ 3 ], b[ 3 ] );
		a[ 4 ] = Math.max( a[ 4 ], b[ 4 ] );
		a[ 5 ] = Math.max( a[ 5 ], b[ 5 ] );

		return this;

	}

	/**
	 * Sets the node's bounding data from raw values.
	 * @param {number} minX
	 * @param {number} minY
	 * @param {number} minZ
	 * @param {number} maxX
	 * @param {number} maxY
	 * @param {number} maxZ
	 * @returns {BVHNode} this
	 */
	setBounds( minX, minY, minZ, maxX, maxY, maxZ ) {

		const d = this.boundingData;
		d[ 0 ] = minX;
		d[ 1 ] = minY;
		d[ 2 ] = minZ;
		d[ 3 ] = maxX;
		d[ 4 ] = maxY;
		d[ 5 ] = maxZ;
		return this;

	}

	/**
	 * Computes the squared distance from a point to the closest point on the node's
	 * bounding box. Returns 0 if the point is inside the box.
	 * @param {Vector3} point
	 * @returns {number}
	 */
	distanceSqToPoint( point ) {

		const d = this.boundingData;
		let dx = Math.max( d[ 0 ] - point.x, 0, point.x - d[ 3 ] );
		let dy = Math.max( d[ 1 ] - point.y, 0, point.y - d[ 4 ] );
		let dz = Math.max( d[ 2 ] - point.z, 0, point.z - d[ 5 ] );
		return dx * dx + dy * dy + dz * dz;

	}

}
