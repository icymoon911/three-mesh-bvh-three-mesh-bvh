/* eslint-disable indent */
import { Box3, Sphere } from 'three';
import { ExtendedTriangle } from '../../math/ExtendedTriangle.js';
import { setTriangle } from '../../utils/TriangleUtilities.js';
import { arrayToBox } from '../../utils/ArrayBoxUtilities.js';
import { COUNT, OFFSET, IS_LEAF, BOUNDING_DATA_INDEX, LEFT_NODE, RIGHT_NODE } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';

const boundingBox = /* @__PURE__ */ new Box3();
const triangle = /* @__PURE__ */ new ExtendedTriangle();

export function collectIntersectingTriangles/* @echo INDIRECT_STRING */( bvh, root, sphere, results ) {

	BufferStack.setBuffer( bvh._roots[ root ] );
	const result = _collectIntersectingTriangles( 0, bvh, sphere, results );
	BufferStack.clearBuffer();

	return result;

}

function _collectIntersectingTriangles( nodeIndex32, bvh, sphere, results ) {

	const { float32Array, uint16Array, uint32Array } = BufferStack;
	let nodeIndex16 = nodeIndex32 * 2;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const thisGeometry = bvh.geometry;
		const thisIndex = thisGeometry.index;
		const thisPos = thisGeometry.attributes.position;

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		/* @if INDIRECT */

		for ( let i = offset, l = count + offset; i < l; i ++ ) {

			const ti = bvh.resolveTriangleIndex( i );
			setTriangle( triangle, 3 * ti, thisIndex, thisPos );
			triangle.needsUpdate = true;

			if ( triangle.intersectsSphere( sphere ) ) {

				results.push( ti );

			}

		}

		/* @else */

		for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

			setTriangle( triangle, i, thisIndex, thisPos );
			triangle.needsUpdate = true;

			if ( triangle.intersectsSphere( sphere ) ) {

				results.push( i / 3 );

			}

		}

		/* @endif */

	} else {

		const left = LEFT_NODE( nodeIndex32 );
		const right = RIGHT_NODE( nodeIndex32, uint32Array );

		arrayToBox( BOUNDING_DATA_INDEX( left ), float32Array, boundingBox );
		if ( sphere.intersectsBox( boundingBox ) ) {

			_collectIntersectingTriangles( left, bvh, sphere, results );

		}

		arrayToBox( BOUNDING_DATA_INDEX( right ), float32Array, boundingBox );
		if ( sphere.intersectsBox( boundingBox ) ) {

			_collectIntersectingTriangles( right, bvh, sphere, results );

		}

	}

	return results.length;

}
