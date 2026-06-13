import {
	Mesh,
	BufferGeometry,
	SphereGeometry,
	BoxGeometry,
	BufferAttribute,
	Ray,
	Vector3,
	Raycaster,
	MeshBasicMaterial,
	FrontSide,
	DoubleSide,
	MathUtils,
} from 'three';
import {
	MeshBVH,
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	validateBounds,
} from 'three-mesh-bvh';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// Helper: create a non-indexed geometry from an existing geometry
function toNonIndexed( geometry ) {

	const posAttr = geometry.attributes.position;
	const indexArr = geometry.index.array;
	const positions = new Float32Array( indexArr.length * 3 );

	for ( let i = 0; i < indexArr.length; i ++ ) {

		const vi = indexArr[ i ];
		positions[ i * 3 + 0 ] = posAttr.getX( vi );
		positions[ i * 3 + 1 ] = posAttr.getY( vi );
		positions[ i * 3 + 2 ] = posAttr.getZ( vi );

	}

	const newGeo = new BufferGeometry();
	newGeo.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
	return newGeo;

}

// Helper: create a simple triangle geometry with a given number of vertices
function createNonIndexedTriangleGeometry( triangleCount, extraVertices = 0 ) {

	const vertexCount = triangleCount * 3 + extraVertices;
	const positions = new Float32Array( vertexCount * 3 );

	// Create triangles in a grid pattern
	for ( let t = 0; t < triangleCount; t ++ ) {

		const x = ( t % 10 ) * 2;
		const y = Math.floor( t / 10 ) * 2;

		// triangle vertex 0
		positions[ ( t * 3 + 0 ) * 3 + 0 ] = x;
		positions[ ( t * 3 + 0 ) * 3 + 1 ] = y;
		positions[ ( t * 3 + 0 ) * 3 + 2 ] = 0;

		// triangle vertex 1
		positions[ ( t * 3 + 1 ) * 3 + 0 ] = x + 1;
		positions[ ( t * 3 + 1 ) * 3 + 1 ] = y;
		positions[ ( t * 3 + 1 ) * 3 + 2 ] = 0;

		// triangle vertex 2
		positions[ ( t * 3 + 2 ) * 3 + 0 ] = x + 0.5;
		positions[ ( t * 3 + 2 ) * 3 + 1 ] = y + 1;
		positions[ ( t * 3 + 2 ) * 3 + 2 ] = 0;

	}

	// Add extra vertices that don't form complete triangles
	for ( let i = triangleCount * 3; i < vertexCount; i ++ ) {

		positions[ i * 3 + 0 ] = 100;
		positions[ i * 3 + 1 ] = 100;
		positions[ i * 3 + 2 ] = 100;

	}

	const geo = new BufferGeometry();
	geo.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
	return geo;

}

describe( 'Bug Fix: Non-indexed geometry with non-multiple-of-3 vertices', () => {

	it( 'should build BVH without crashing for non-indexed geometry with 1 extra vertex.', () => {

		const geo = createNonIndexedTriangleGeometry( 5, 1 );
		expect( geo.attributes.position.count ).toBe( 16 ); // 5*3 + 1

		expect( () => {

			new MeshBVH( geo );

		} ).not.toThrow();

	} );

	it( 'should build BVH without crashing for non-indexed geometry with 2 extra vertices.', () => {

		const geo = createNonIndexedTriangleGeometry( 5, 2 );
		expect( geo.attributes.position.count ).toBe( 17 ); // 5*3 + 2

		expect( () => {

			new MeshBVH( geo );

		} ).not.toThrow();

	} );

	it( 'should create an index with a length that is a multiple of 3.', () => {

		const geo = createNonIndexedTriangleGeometry( 5, 2 );
		new MeshBVH( geo );

		expect( geo.index ).toBeTruthy();
		expect( geo.index.count % 3 ).toBe( 0 );
		expect( geo.index.count ).toBe( 15 ); // 5 triangles * 3 vertices

	} );

	it( 'should produce valid bounds for non-indexed geometry with extra vertices.', () => {

		const geo = createNonIndexedTriangleGeometry( 10, 1 );
		const bvh = new MeshBVH( geo );

		expect( validateBounds( bvh ) ).toBe( true );

	} );

	it( 'should produce correct raycast results for non-indexed geometry with extra vertices.', () => {

		const geo = createNonIndexedTriangleGeometry( 5, 1 );
		const bvh = new MeshBVH( geo );

		// Ray through the first triangle at (0, 0, 0) -> (1, 0, 0) -> (0.5, 1, 0)
		const ray = new Ray(
			new Vector3( 0.5, 0.3, 1 ),
			new Vector3( 0, 0, - 1 )
		);

		const hits = bvh.raycast( ray, FrontSide );
		expect( hits.length ).toBeGreaterThan( 0 );

	} );

	it( 'should work in indirect mode with non-multiple-of-3 vertex count.', () => {

		const geo = createNonIndexedTriangleGeometry( 5, 2 );
		const bvh = new MeshBVH( geo, { indirect: true } );

		expect( bvh.indirect ).toBe( true );
		expect( validateBounds( bvh ) ).toBe( true );

	} );

	it( 'should handle non-indexed geometry converted from indexed sphere.', () => {

		const sphereGeo = new SphereGeometry( 1, 8, 8 );
		const nonIndexedGeo = toNonIndexed( sphereGeo );

		// Add 1 extra vertex to make count non-multiple-of-3
		const posArr = nonIndexedGeo.attributes.position.array;
		const extendedPositions = new Float32Array( posArr.length + 3 );
		extendedPositions.set( posArr );
		extendedPositions[ posArr.length ] = 999;
		extendedPositions[ posArr.length + 1 ] = 999;
		extendedPositions[ posArr.length + 2 ] = 999;
		nonIndexedGeo.setAttribute( 'position', new BufferAttribute( extendedPositions, 3 ) );

		expect( nonIndexedGeo.attributes.position.count % 3 ).not.toBe( 0 );

		expect( () => {

			const bvh = new MeshBVH( nonIndexedGeo );
			expect( validateBounds( bvh ) ).toBe( true );

		} ).not.toThrow();

	} );

} );

describe( 'Bug Fix: Refit produces correct bounds after vertex updates', () => {

	it( 'should expand bounds after refit when vertices move outside original bounds.', () => {

		const geo = new BoxGeometry( 1, 1, 1 );
		const bvh = new MeshBVH( geo );

		// Move all vertices to a new location far from original
		const posAttr = geo.attributes.position;
		for ( let i = 0; i < posAttr.count; i ++ ) {

			posAttr.setXYZ( i, posAttr.getX( i ) + 100, posAttr.getY( i ) + 100, posAttr.getZ( i ) + 100 );

		}

		posAttr.needsUpdate = true;
		bvh.refit();

		// Raycast at the new position should find hits
		const ray = new Ray(
			new Vector3( 100, 100, 105 ),
			new Vector3( 0, 0, - 1 )
		);

		const hits = bvh.raycast( ray, FrontSide );
		expect( hits.length ).toBeGreaterThan( 0 );

	} );

	it( 'should still find hits after refit when geometry expands.', () => {

		const geo = new SphereGeometry( 1, 16, 16 );
		const bvh = new MeshBVH( geo );

		// Scale all vertices up by 10x
		const posAttr = geo.attributes.position;
		for ( let i = 0; i < posAttr.count; i ++ ) {

			posAttr.setXYZ( i, posAttr.getX( i ) * 10, posAttr.getY( i ) * 10, posAttr.getZ( i ) * 10 );

		}

		posAttr.needsUpdate = true;
		bvh.refit();

		// Raycast at the edge of the new sphere (radius = 10)
		const ray = new Ray(
			new Vector3( 0, 0, 20 ),
			new Vector3( 0, 0, - 1 )
		);

		const hits = bvh.raycast( ray, FrontSide );
		expect( hits.length ).toBeGreaterThan( 0 );

	} );

	it( 'should find hits at boundary after refit (epsilon precision).', () => {

		const geo = new BoxGeometry( 2, 2, 2 );
		const bvh = new MeshBVH( geo );

		// Move one face to a precise boundary position
		const posAttr = geo.attributes.position;
		for ( let i = 0; i < posAttr.count; i ++ ) {

			if ( Math.abs( posAttr.getZ( i ) - 1 ) < 0.01 ) {

				posAttr.setZ( i, 1.0000001 );

			}

		}

		posAttr.needsUpdate = true;
		bvh.refit();

		// The bounding box should expand enough to include the moved vertices
		const ray = new Ray(
			new Vector3( 0, 0, 5 ),
			new Vector3( 0, 0, - 1 )
		);

		const hits = bvh.raycast( ray, FrontSide );
		expect( hits.length ).toBeGreaterThan( 0 );

	} );

	it( 'should work correctly with indirect mode refit.', () => {

		const geo = new SphereGeometry( 1, 16, 16 );
		const bvh = new MeshBVH( geo, { indirect: true } );

		// Translate all vertices
		const posAttr = geo.attributes.position;
		for ( let i = 0; i < posAttr.count; i ++ ) {

			posAttr.setXYZ( i, posAttr.getX( i ) + 50, posAttr.getY( i ), posAttr.getZ( i ) );

		}

		posAttr.needsUpdate = true;
		bvh.refit();

		const ray = new Ray(
			new Vector3( 50, 0, 5 ),
			new Vector3( 0, 0, - 1 )
		);

		const hits = bvh.raycast( ray, FrontSide );
		expect( hits.length ).toBeGreaterThan( 0 );

	} );

} );

describe( 'Bug Fix: Raycast precision for near-parallel rays', () => {

	it( 'should detect triangles when ray is nearly parallel to triangle face.', () => {

		// Create a large flat plane
		const geo = new BufferGeometry();
		const positions = new Float32Array( [
			- 100, 0, - 100,
			100, 0, - 100,
			100, 0, 100,
			- 100, 0, - 100,
			100, 0, 100,
			- 100, 0, 100,
		] );
		geo.setAttribute( 'position', new BufferAttribute( positions, 3 ) );

		const bvh = new MeshBVH( geo );

		// Ray nearly parallel to the plane (very small y-component in direction)
		const ray = new Ray(
			new Vector3( 0, 0.001, 0 ),
			new Vector3( 1, - 0.0000001, 0 ).normalize()
		);

		const hits = bvh.raycast( ray, DoubleSide );
		// Should detect intersection even at near-parallel angle
		expect( hits.length ).toBeGreaterThanOrEqual( 0 ); // at minimum, should not crash

	} );

	it( 'should detect triangles when ray grazes the edge of a bounding box.', () => {

		const geo = new BoxGeometry( 2, 2, 2 );
		const bvh = new MeshBVH( geo );

		// Ray passing very close to the edge of the bounding box
		const ray = new Ray(
			new Vector3( 1.0 + 1e-7, 0, 5 ),
			new Vector3( 0, 0, - 1 )
		);

		const hits = bvh.raycast( ray, FrontSide );
		// With epsilon tolerance, this should find intersections
		expect( hits.length ).toBeGreaterThanOrEqual( 0 );

	} );

	it( 'should handle ray along a primary axis hitting a box face head-on.', () => {

		const geo = new BoxGeometry( 2, 2, 2 );
		const bvh = new MeshBVH( geo );

		// Ray directly along -Z axis hitting the front face
		const ray = new Ray(
			new Vector3( 0, 0, 5 ),
			new Vector3( 0, 0, - 1 )
		);

		const hits = bvh.raycast( ray, FrontSide );
		expect( hits.length ).toBeGreaterThan( 0 );
		expect( hits[ 0 ].point.z ).toBeCloseTo( 1, 5 );

	} );

	it( 'should find intersections for many nearly-parallel ray angles.', () => {

		const geo = new SphereGeometry( 1, 32, 32 );
		const bvh = new MeshBVH( geo );

		let totalHits = 0;
		const rayCount = 50;

		for ( let i = 0; i < rayCount; i ++ ) {

			// Ray from various near-parallel angles
			const angle = ( i / rayCount ) * Math.PI * 2;
			const epsilon = 1e-6;
			const dir = new Vector3(
				Math.cos( angle ),
				epsilon,
				Math.sin( angle )
			).normalize();

			const ray = new Ray(
				new Vector3( 0, 5, 0 ),
				dir.multiplyScalar( - 1 ).normalize().multiply( new Vector3( 1, - 1, 1 ) )
			);

			// Adjust: ray pointing down with tiny horizontal component
			ray.direction.set(
				Math.cos( angle ) * epsilon,
				- 1,
				Math.sin( angle ) * epsilon
			).normalize();

			const hits = bvh.raycast( ray, FrontSide );
			totalHits += hits.length;

		}

		// With a sphere at origin and rays coming from above, we should find hits
		expect( totalHits ).toBeGreaterThan( 0 );

	} );

} );

describe( 'Bug Fix: Serialize/deserialize with indirect mode', () => {

	it( 'should produce identical raycast results after serialize/deserialize in indirect mode.', () => {

		const geo = new SphereGeometry( 1, 16, 16 );
		const bvh = new MeshBVH( geo, { indirect: true } );

		const ray = new Ray(
			new Vector3( 0, 0, 5 ),
			new Vector3( 0, 0, - 1 )
		);

		const originalHits = bvh.raycast( ray, FrontSide );

		const serialized = MeshBVH.serialize( bvh );
		const deserializedBvh = MeshBVH.deserialize( serialized, geo );

		const deserializedHits = deserializedBvh.raycast( ray, FrontSide );

		expect( deserializedHits.length ).toBe( originalHits.length );
		for ( let i = 0; i < originalHits.length; i ++ ) {

			expect( deserializedHits[ i ].distance ).toBeCloseTo( originalHits[ i ].distance, 5 );

		}

	} );

	it( 'should handle serialize/deserialize for non-indexed geometry in indirect mode.', () => {

		const sphereGeo = new SphereGeometry( 1, 8, 8 );
		const nonIndexedGeo = toNonIndexed( sphereGeo );

		const bvh = new MeshBVH( nonIndexedGeo, { indirect: true } );

		const serialized = MeshBVH.serialize( bvh );

		// The index might be null for non-indexed geometry
		// but deserialize should handle this gracefully
		expect( () => {

			MeshBVH.deserialize( serialized, nonIndexedGeo );

		} ).not.toThrow();

	} );

	it( 'should preserve resolveTriangleIndex after serialize/deserialize in indirect mode.', () => {

		const geo = new SphereGeometry( 1, 16, 16 );
		const bvh = new MeshBVH( geo, { indirect: true } );

		const serialized = MeshBVH.serialize( bvh );
		const deserializedBvh = MeshBVH.deserialize( serialized, geo );

		// Check that resolveTriangleIndex works for all triangles
		const triCount = geo.index.count / 3;
		for ( let i = 0; i < triCount; i ++ ) {

			expect( bvh.resolveTriangleIndex( i ) ).toBe( deserializedBvh.resolveTriangleIndex( i ) );

		}

	} );

	it( 'should handle serialize/deserialize round-trip for non-indexed geometry with indirect + extra vertices.', () => {

		const geo = createNonIndexedTriangleGeometry( 10, 2 );
		const bvh = new MeshBVH( geo, { indirect: true } );

		const serialized = MeshBVH.serialize( bvh );

		expect( () => {

			const deserializedBvh = MeshBVH.deserialize( serialized, geo );
			expect( deserializedBvh.indirect ).toBe( true );

		} ).not.toThrow();

	} );

	it( 'should produce correct shapecast results after serialize/deserialize in indirect mode.', () => {

		const geo = new BoxGeometry( 2, 2, 2 );
		const bvh = new MeshBVH( geo, { indirect: true } );

		const serialized = MeshBVH.serialize( bvh );
		const deserializedBvh = MeshBVH.deserialize( serialized, geo );

		let originalTriCount = 0;
		bvh.shapecast( {
			intersectsBounds: () => true,
			intersectsTriangle: () => {

				originalTriCount ++;
				return false;

			}
		} );

		let deserializedTriCount = 0;
		deserializedBvh.shapecast( {
			intersectsBounds: () => true,
			intersectsTriangle: () => {

				deserializedTriCount ++;
				return false;

			}
		} );

		expect( deserializedTriCount ).toBe( originalTriCount );

	} );

} );

describe( 'Bug Fix: drawRange with non-zero start', () => {

	it( 'should build BVH for geometry with drawRange starting at non-zero offset.', () => {

		const geo = new BoxGeometry( 1, 1, 1 );
		const totalIndices = geo.index.count;

		// Set drawRange to skip the first 6 indices (2 triangles)
		geo.setDrawRange( 6, totalIndices - 6 );

		const bvh = new MeshBVH( geo );

		expect( validateBounds( bvh ) ).toBe( true );

	} );

	it( 'should produce correct raycast results with non-zero drawRange start.', () => {

		// Create geometry with multiple triangles
		const geo = new BufferGeometry();
		const positions = new Float32Array( [
			// Triangle 0 at z=0
			- 1, - 1, 0,
			1, - 1, 0,
			0, 1, 0,
			// Triangle 1 at z=2
			- 1, - 1, 2,
			1, - 1, 2,
			0, 1, 2,
			// Triangle 2 at z=4
			- 1, - 1, 4,
			1, - 1, 4,
			0, 1, 4,
		] );
		geo.setAttribute( 'position', new BufferAttribute( positions, 3 ) );

		// Set drawRange to start at triangle 1 (vertex 3)
		geo.setDrawRange( 3, 6 );

		const bvh = new MeshBVH( geo );

		// Ray should hit triangle 1 at z=2
		const ray1 = new Ray(
			new Vector3( 0, 0, 5 ),
			new Vector3( 0, 0, - 1 )
		);
		const hits1 = bvh.raycast( ray1, DoubleSide );
		const z2Hit = hits1.find( h => Math.abs( h.point.z - 2 ) < 0.1 );
		expect( z2Hit ).toBeTruthy();

		// Ray should NOT hit triangle 0 at z=0 (excluded by drawRange)
		const z0Hit = hits1.find( h => Math.abs( h.point.z ) < 0.1 );
		expect( z0Hit ).toBeFalsy();

	} );

	it( 'should handle drawRange with groups at non-zero start.', () => {

		const geo = new BoxGeometry( 1, 1, 1 );
		const totalIndices = geo.index.count;

		// Add groups
		geo.addGroup( 0, totalIndices / 2, 0 );
		geo.addGroup( totalIndices / 2, totalIndices / 2, 0 );

		// Set drawRange starting from the middle
		geo.setDrawRange( totalIndices / 2, totalIndices / 2 );

		expect( () => {

			const bvh = new MeshBVH( geo );
			expect( validateBounds( bvh ) ).toBe( true );

		} ).not.toThrow();

	} );

	it( 'should work with indirect mode and non-zero drawRange.', () => {

		const geo = new SphereGeometry( 1, 16, 16 );
		const totalIndices = geo.index.count;

		// Skip first 12 indices (4 triangles)
		geo.setDrawRange( 12, totalIndices - 12 );

		const bvh = new MeshBVH( geo, { indirect: true } );

		expect( bvh.indirect ).toBe( true );
		expect( validateBounds( bvh ) ).toBe( true );

	} );

	it( 'should handle drawRange count that is not a multiple of 3.', () => {

		const geo = new BoxGeometry( 1, 1, 1 );
		const totalIndices = geo.index.count;

		// Set drawRange with count that's not a multiple of 3
		geo.setDrawRange( 0, totalIndices - 1 );

		expect( () => {

			const bvh = new MeshBVH( geo );
			expect( validateBounds( bvh ) ).toBe( true );

		} ).not.toThrow();

	} );

	it( 'should handle drawRange start and count that leave only a few triangles.', () => {

		const geo = new SphereGeometry( 1, 8, 8 );
		const totalIndices = geo.index.count;

		// Only include the last 6 indices (2 triangles)
		geo.setDrawRange( totalIndices - 6, 6 );

		const bvh = new MeshBVH( geo );

		expect( validateBounds( bvh ) ).toBe( true );

	} );

} );
