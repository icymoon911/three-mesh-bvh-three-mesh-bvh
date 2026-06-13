import { IS_LEAFNODE_FLAG, UINT32_PER_NODE, BYTES_PER_NODE } from './Constants.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';
import { Box3 } from 'three';

const _tempBox = /* @__PURE__ */ new Box3();

/**
 * Represents a single node in the BVH tree during construction.
 * Internal nodes have `left`, `right`, and `splitAxis`.
 * Leaf nodes have `offset` and `count` referring to primitives in the geometry.
 */
export class BVHNode {

	constructor() {

		this.boundingData = new Float32Array( 6 );

	}

	/**
	 * Returns true if this node is a leaf (has offset/count rather than children).
	 * @returns {boolean}
	 */
	get isLeaf() {

		return 'count' in this;

	}

	/**
	 * Computes the surface area of this node's bounding box.
	 * @returns {number}
	 */
	getSurfaceArea() {

		const d = this.boundingData;
		const dx = d[ 3 ] - d[ 0 ];
		const dy = d[ 4 ] - d[ 1 ];
		const dz = d[ 5 ] - d[ 2 ];
		return 2 * ( dx * dy + dy * dz + dz * dx );

	}

	/**
	 * Copies this node's bounding data into a Box3.
	 * @param {Box3} target
	 * @returns {Box3}
	 */
	getBox( target ) {

		const d = this.boundingData;
		target.min.set( d[ 0 ], d[ 1 ], d[ 2 ] );
		target.max.set( d[ 3 ], d[ 4 ], d[ 5 ] );
		return target;

	}

	/**
	 * Sets this node's bounding data from min/max values.
	 * @param {number} minx
	 * @param {number} miny
	 * @param {number} minz
	 * @param {number} maxx
	 * @param {number} maxy
	 * @param {number} maxz
	 * @returns {BVHNode}
	 */
	setBounds( minx, miny, minz, maxx, maxy, maxz ) {

		this.boundingData[ 0 ] = minx;
		this.boundingData[ 1 ] = miny;
		this.boundingData[ 2 ] = minz;
		this.boundingData[ 3 ] = maxx;
		this.boundingData[ 4 ] = maxy;
		this.boundingData[ 5 ] = maxz;
		return this;

	}

	/**
	 * Expands this node's bounding box to include another bounding box.
	 * @param {Float32Array} otherBounds - 6-element [minx,miny,minz,maxx,maxy,maxz]
	 * @returns {BVHNode}
	 */
	unionWith( otherBounds ) {

		const d = this.boundingData;
		if ( otherBounds[ 0 ] < d[ 0 ] ) d[ 0 ] = otherBounds[ 0 ];
		if ( otherBounds[ 1 ] < d[ 1 ] ) d[ 1 ] = otherBounds[ 1 ];
		if ( otherBounds[ 2 ] < d[ 2 ] ) d[ 2 ] = otherBounds[ 2 ];
		if ( otherBounds[ 3 ] > d[ 3 ] ) d[ 3 ] = otherBounds[ 3 ];
		if ( otherBounds[ 4 ] > d[ 4 ] ) d[ 4 ] = otherBounds[ 4 ];
		if ( otherBounds[ 5 ] > d[ 5 ] ) d[ 5 ] = otherBounds[ 5 ];
		return this;

	}

	/**
	 * Returns the longest axis index (0=x, 1=y, 2=z) of this node's bounding box.
	 * @returns {number}
	 */
	getLongestAxisIndex() {

		const d = this.boundingData;
		const x = d[ 3 ] - d[ 0 ];
		const y = d[ 4 ] - d[ 1 ];
		const z = d[ 5 ] - d[ 2 ];
		if ( x > y && x > z ) return 0;
		if ( y > z ) return 1;
		return 2;

	}

	/**
	 * Counts the total number of nodes in the subtree rooted at this node.
	 * @returns {number}
	 */
	countNodes() {

		if ( this.isLeaf ) {

			return 1;

		}

		return 1 + this.left.countNodes() + this.right.countNodes();

	}

	// --- Static helpers for packed-buffer node queries ---

	/**
	 * Checks if the node at the given index in the packed buffer is a leaf.
	 * @param {number} nodeIndex16 - The uint16-aligned index of the node.
	 * @param {Uint16Array} uint16Array
	 * @returns {boolean}
	 */
	static isLeaf( nodeIndex16, uint16Array ) {

		return uint16Array[ nodeIndex16 + 15 ] === IS_LEAFNODE_FLAG;

	}

	/**
	 * Reads the bounding box from a packed buffer at the given node index
	 * and writes it into a Box3.
	 * @param {number} nodeIndex32 - The uint32-aligned index of the node.
	 * @param {Float32Array} float32Array
	 * @param {Box3} target
	 * @returns {Box3}
	 */
	static getBoxFromBuffer( nodeIndex32, float32Array, target ) {

		return arrayToBox( nodeIndex32, float32Array, target );

	}

	/**
	 * Computes the bounding box union of all primitives in the given leaf range
	 * using the BVH's writePrimitiveRangeBounds method.
	 * @param {object} bvh - The BVH instance providing writePrimitiveRangeBounds.
	 * @param {number} offset - Primitive offset.
	 * @param {number} count - Primitive count.
	 * @param {Box3} target
	 * @returns {Box3}
	 */
	static computePrimitiveRangeBox( bvh, offset, count, target ) {

		const buffer = new Float32Array( 6 );
		bvh.writePrimitiveRangeBounds( offset, count, buffer, 0 );
		target.min.set( buffer[ 0 ], buffer[ 1 ], buffer[ 2 ] );
		target.max.set( buffer[ 3 ], buffer[ 4 ], buffer[ 5 ] );
		return target;

	}

}
