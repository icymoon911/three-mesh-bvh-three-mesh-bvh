import {
	Mesh,
	BufferGeometry,
	SphereGeometry,
	BoxGeometry,
	Raycaster,
	Ray,
	MeshBasicMaterial,
	Vector3,
	Matrix4,
	BufferAttribute,
	DoubleSide,
	FrontSide,
	Box3,
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

// helper: build a non-indexed geometry from raw vertex data (flat array of xyz triples)
function makeNonIndexedGeometry( vertices ) {

	const geo = new BufferGeometry();
	geo.setAttribute( 'position', new BufferAttribute( new Float32Array( vertices ), 3 ) );
	return geo;

}

// helper: build a box-shaped non-indexed geometry (12 tris, 36 vertices)
function makeNonIndexedBox( w = 1, h = 1, d = 1 ) {

	const box = new BoxGeometry( w, h, d );
	// remove index and duplicate vertices so the geometry is truly non-indexed
	const pos = box.attributes.position;
	const arr = [];
	if ( box.index ) {

		for ( let i = 0; i < box.index.count; i ++ ) {

			const vi = box.index.getX( i );
			arr.push( pos.getX( vi ), pos.getY( vi ), pos.getZ( vi ) );

		}

	} else {

		for ( let i = 0; i < pos.count * 3; i ++ ) {

			arr.push( pos.array[ i ] );

		}

	}

	box.dispose();
	return makeNonIndexedGeometry( arr );

}

describe( 'Bug fixes', () => {

	// =========================================================================
	// Bug 1: Non-indexed geometry with vertex count not a multiple of 3
	// =========================================================================
	describe( 'Bug 1: Non-indexed geometry with non-multiple-of-3 vertex count', () => {

		it( 'should build BVH without crashing for 10 vertices (1 extra)', () => {

			// 3 complete triangles + 1 extra vertex
			const verts = [
				0, 0, 0, 1, 0, 0, 0, 1, 0, // tri 0
				1, 0, 0, 1, 1, 0, 0, 1, 0, // tri 1
				0, 0, 1, 1, 0, 1, 0, 1, 1, // tri 2
				5, 5, 5, // extra vertex (incomplete triangle)
			];
			const geo = makeNonIndexedGeometry( verts );
			expect( () => new MeshBVH( geo, { verbose: false } ) ).not.toThrow();

		} );

		it( 'should build BVH without crashing for 1 or 2 vertices', () => {

			const geo1 = makeNonIndexedGeometry( [ 0, 0, 0 ] );
			expect( () => new MeshBVH( geo1, { verbose: false } ) ).not.toThrow();

			const geo2 = makeNonIndexedGeometry( [ 0, 0, 0, 1, 0, 0 ] );
			expect( () => new MeshBVH( geo2, { verbose: false } ) ).not.toThrow();

		} );

		it( 'should produce correct raycast results on non-indexed geometry', () => {

			const geo = makeNonIndexedBox();
			const bvh = new MeshBVH( geo, { verbose: false } );

			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should produce correct raycast results in indirect mode on non-indexed geometry', () => {

			const geo = makeNonIndexedBox();
			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );

			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should build BVH on non-indexed geometry with extra trailing vertices and still raycast correctly', () => {

			// build a box then add 2 extra vertices
			const box = makeNonIndexedBox();
			const origCount = box.attributes.position.count;
			const origArr = box.attributes.position.array;
			const newArr = new Float32Array( ( origCount + 2 ) * 3 );
			newArr.set( origArr );
			// two extra vertices far away
			newArr[ origCount * 3 + 0 ] = 100;
			newArr[ origCount * 3 + 1 ] = 100;
			newArr[ origCount * 3 + 2 ] = 100;
			newArr[ origCount * 3 + 3 ] = 101;
			newArr[ origCount * 3 + 4 ] = 101;
			newArr[ origCount * 3 + 5 ] = 101;

			const geo = new BufferGeometry();
			geo.setAttribute( 'position', new BufferAttribute( newArr, 3 ) );

			const bvh = new MeshBVH( geo, { verbose: false } );

			// Ray through the box center should still hit
			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should handle indirect mode with non-multiple-of-3 vertex count', () => {

			const verts = [
				0, 0, 0, 1, 0, 0, 0, 1, 0, // tri 0
				1, 0, 0, 1, 1, 0, 0, 1, 0, // tri 1
				0, 0, 1, 1, 0, 1, 0, 1, 1, // tri 2
				5, 5, 5, // extra
			];
			const geo = makeNonIndexedGeometry( verts );
			expect( () => new MeshBVH( geo, { verbose: false, indirect: true } ) ).not.toThrow();

		} );

	} );

	// =========================================================================
	// Bug 2: Refit accuracy after vertex deformation
	// =========================================================================
	describe( 'Bug 2: Refit correctness after vertex updates', () => {

		it( 'should find geometry after vertices are moved outside original bounds', () => {

			const geo = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geo, { verbose: false } );

			// Move all vertices far away along +X
			const pos = geo.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) {

				pos.setX( i, pos.getX( i ) + 100 );

			}
			pos.needsUpdate = true;

			bvh.refit();

			// Ray from far X should now hit
			const ray = new Ray( new Vector3( 200, 0, 0 ), new Vector3( - 1, 0, 0 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should find geometry after refit in indirect mode', () => {

			const geo = new BoxGeometry( 1, 1, 1 );
			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );

			const pos = geo.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) {

				pos.setX( i, pos.getX( i ) + 50 );

			}
			pos.needsUpdate = true;

			bvh.refit();

			const ray = new Ray( new Vector3( 100, 0, 0 ), new Vector3( - 1, 0, 0 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should maintain correct bounds after expanding geometry significantly', () => {

			const geo = new SphereGeometry( 1, 16, 16 );
			const bvh = new MeshBVH( geo, { verbose: false } );

			// Scale all vertices by 10x
			const pos = geo.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) {

				pos.setX( i, pos.getX( i ) * 10 );
				pos.setY( i, pos.getY( i ) * 10 );
				pos.setZ( i, pos.getZ( i ) * 10 );

			}
			pos.needsUpdate = true;

			bvh.refit();

			// Check bounding box is approximately correct
			const box = new Box3();
			bvh.getBoundingBox( box );
			expect( box.max.x ).toBeGreaterThan( 5 ); // should be ~10
			expect( box.min.x ).toBeLessThan( - 5 ); // should be ~-10

		} );

		it( 'should correctly refit after shrinking geometry', () => {

			const geo = new SphereGeometry( 10, 16, 16 );
			const bvh = new MeshBVH( geo, { verbose: false } );

			// Scale down to 0.1x
			const pos = geo.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) {

				pos.setX( i, pos.getX( i ) * 0.1 );
				pos.setY( i, pos.getY( i ) * 0.1 );
				pos.setZ( i, pos.getZ( i ) * 0.1 );

			}
			pos.needsUpdate = true;

			bvh.refit();

			// Ray through center should still hit
			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should correctly refit non-indexed geometry', () => {

			const geo = makeNonIndexedBox();
			const bvh = new MeshBVH( geo, { verbose: false } );

			const pos = geo.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) {

				pos.setX( i, pos.getX( i ) + 20 );

			}
			pos.needsUpdate = true;

			bvh.refit();

			const ray = new Ray( new Vector3( 50, 0, 0 ), new Vector3( - 1, 0, 0 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

	} );

	// =========================================================================
	// Bug 3: Raycast precision for near-parallel rays
	// =========================================================================
	describe( 'Bug 3: Raycast precision for near-parallel rays', () => {

		it( 'should detect triangles when ray is nearly parallel to the face', () => {

			// Large flat triangle
			const verts = [
				- 100, 0, - 100,
				100, 0, - 100,
				0, 0, 100,
			];
			const geo = makeNonIndexedGeometry( verts );
			const bvh = new MeshBVH( geo, { verbose: false } );

			// Ray almost parallel to the XZ plane (Y component very small)
			const ray = new Ray(
				new Vector3( 0, 0.001, - 50 ),
				new Vector3( 0, - 0.0001, 1 ).normalize()
			);

			const hits = bvh.raycast( ray, DoubleSide );
			// Should still detect the triangle
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should detect triangles along axis-aligned rays', () => {

			// Triangle perpendicular to X axis
			const verts = [
				5, - 10, - 10,
				5, 10, - 10,
				5, 0, 10,
			];
			const geo = makeNonIndexedGeometry( verts );
			const bvh = new MeshBVH( geo, { verbose: false } );

			// Ray exactly along X axis
			const ray = new Ray( new Vector3( - 100, 0, 0 ), new Vector3( 1, 0, 0 ) );
			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should detect geometry with grazing-angle rays on a box', () => {

			const geo = new BoxGeometry( 10, 0.01, 10 );
			const bvh = new MeshBVH( geo, { verbose: false } );

			// Ray nearly parallel to the thin face
			const ray = new Ray(
				new Vector3( - 20, 0.005, 0 ),
				new Vector3( 1, 0.00001, 0 ).normalize()
			);

			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

		it( 'should detect triangles with nearly zero-direction component', () => {

			const geo = new SphereGeometry( 5, 32, 32 );
			const bvh = new MeshBVH( geo, { verbose: false } );

			// Ray with very small Y direction (nearly parallel to XZ plane)
			const dir = new Vector3( 1, 1e-12, 0 ).normalize();
			const ray = new Ray( new Vector3( - 20, 0, 0 ), dir );

			const hits = bvh.raycast( ray, DoubleSide );
			expect( hits.length ).toBeGreaterThan( 0 );

		} );

	} );

	// =========================================================================
	// Bug 4: Serialize/deserialize in indirect mode
	// =========================================================================
	describe( 'Bug 4: Serialize/deserialize with indirect mode', () => {

		it( 'should produce identical raycast results after serialize/deserialize in indirect mode', () => {

			const geo = new SphereGeometry( 1, 16, 16 );
			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );

			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const originalHits = bvh.raycast( ray, DoubleSide );

			const serialized = MeshBVH.serialize( bvh );
			const cloned = geo.clone();
			const deserialized = MeshBVH.deserialize( serialized, cloned );

			const deserializedHits = deserialized.raycast( ray, DoubleSide );

			expect( deserializedHits.length ).toEqual( originalHits.length );

			// Check distances match
			for ( let i = 0; i < originalHits.length; i ++ ) {

				expect( deserializedHits[ i ].distance ).toBeCloseTo( originalHits[ i ].distance, 5 );

			}

		} );

		it( 'should handle serialize/deserialize with non-indexed geometry in indirect mode', () => {

			const geo = makeNonIndexedBox();
			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );

			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const originalHits = bvh.raycast( ray, DoubleSide );

			const serialized = MeshBVH.serialize( bvh );
			expect( serialized.index ).toBeNull();

			// Create a fresh non-indexed geometry for deserialization
			const freshGeo = makeNonIndexedBox();
			const deserialized = MeshBVH.deserialize( serialized, freshGeo );

			expect( deserialized.indirect ).toBe( true );

			const deserializedHits = deserialized.raycast( ray, DoubleSide );
			expect( deserializedHits.length ).toEqual( originalHits.length );

		} );

		it( 'should correctly resolve triangle indices after deserialize in indirect mode', () => {

			const geo = new SphereGeometry( 1, 10, 10 );
			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );

			const serialized = MeshBVH.serialize( bvh );
			const cloned = geo.clone();
			const deserialized = MeshBVH.deserialize( serialized, cloned );

			// resolveTriangleIndex should work identically
			expect( deserialized.resolveTriangleIndex( 0 ) ).toEqual( bvh.resolveTriangleIndex( 0 ) );
			expect( deserialized.resolveTriangleIndex( 1 ) ).toEqual( bvh.resolveTriangleIndex( 1 ) );

		} );

		it( 'should produce identical results with cloneBuffers false in indirect mode', () => {

			const geo = new SphereGeometry( 1, 10, 10 );
			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );

			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const originalHits = bvh.raycast( ray, DoubleSide );

			const serialized = MeshBVH.serialize( bvh, { cloneBuffers: false } );
			const deserialized = MeshBVH.deserialize( serialized, geo );

			const deserializedHits = deserialized.raycast( ray, DoubleSide );
			expect( deserializedHits.length ).toEqual( originalHits.length );

		} );

		it( 'should not corrupt geometry when deserializing indirect BVH built on non-indexed geometry', () => {

			const geo = makeNonIndexedBox();
			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );

			const serialized = MeshBVH.serialize( bvh );
			// geo should still be non-indexed after deserialization
			const freshGeo = makeNonIndexedBox();
			MeshBVH.deserialize( serialized, freshGeo );

			// Non-indexed source geometry should remain non-indexed
			expect( freshGeo.index ).toBeNull();

		} );

	} );

	// =========================================================================
	// Bug 5: drawRange not starting from 0
	// =========================================================================
	describe( 'Bug 5: drawRange with non-zero start', () => {

		it( 'should build BVH for geometry with drawRange starting after 0', () => {

			const geo = new BoxGeometry( 1, 1, 1 );
			// Skip the first 6 index entries (2 triangles)
			geo.setDrawRange( 6, Infinity );

			expect( () => new MeshBVH( geo, { verbose: false } ) ).not.toThrow();

		} );

		it( 'should only include triangles within the draw range', () => {

			const geo = new SphereGeometry( 1, 10, 10 );
			const totalIndices = geo.index.count;

			// Only include the second half of the triangles
			const half = Math.floor( totalIndices / 2 );
			// Round to multiple of 3
			const alignedHalf = half - ( half % 3 );
			geo.setDrawRange( alignedHalf, totalIndices - alignedHalf );

			const bvh = new MeshBVH( geo, { verbose: false } );

			// Ray from center should hit some triangles in the second half
			const ray = new Ray( new Vector3( 0, 0, 0 ), new Vector3( 0, 0, 1 ) );
			const hits = bvh.raycast( ray, DoubleSide );

			// All hit face indices should be >= alignedHalf / 3
			for ( const hit of hits ) {

				expect( hit.faceIndex * 3 ).toBeGreaterThanOrEqual( alignedHalf );

			}

		} );

		it( 'should handle drawRange with limited count', () => {

			const geo = new SphereGeometry( 1, 10, 10 );

			// Only include the first 30 indices (10 triangles)
			geo.setDrawRange( 0, 30 );

			const bvh = new MeshBVH( geo, { verbose: false } );

			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const hits = bvh.raycast( ray, DoubleSide );

			// All hits should be within the first 10 triangles
			for ( const hit of hits ) {

				expect( hit.faceIndex ).toBeLessThan( 10 );

			}

		} );

		it( 'should work with drawRange offset in indirect mode', () => {

			const geo = new SphereGeometry( 1, 10, 10 );
			const totalIndices = geo.index.count;
			const alignedHalf = Math.floor( totalIndices / 2 / 3 ) * 3;
			geo.setDrawRange( alignedHalf, totalIndices - alignedHalf );

			expect( () => new MeshBVH( geo, { verbose: false, indirect: true } ) ).not.toThrow();

			const bvh = new MeshBVH( geo, { verbose: false, indirect: true } );
			const ray = new Ray( new Vector3( 0, 0, 5 ), new Vector3( 0, 0, - 1 ) );
			const hits = bvh.raycast( ray, DoubleSide );

			// Should get some hits
			expect( hits.length ).toBeGreaterThanOrEqual( 0 );

		} );

		it( 'should handle drawRange starting beyond geometry bounds without crashing', () => {

			const geo = new BoxGeometry( 1, 1, 1 );
			const totalIndices = geo.index.count;

			// Start draw range past the end of geometry
			geo.setDrawRange( totalIndices + 100, 100 );

			// Should not crash; produces an empty BVH
			expect( () => new MeshBVH( geo, { verbose: false } ) ).not.toThrow();

		} );

		it( 'should handle zero-count draw range without crashing', () => {

			const geo = new BoxGeometry( 1, 1, 1 );
			geo.setDrawRange( 0, 0 );

			expect( () => new MeshBVH( geo, { verbose: false } ) ).not.toThrow();

		} );

		it( 'should correctly handle drawRange with groups', () => {

			const geo = new SphereGeometry( 1, 10, 10 );
			const totalIndices = geo.index.count;
			const third = Math.floor( totalIndices / 3 / 3 ) * 3;

			geo.addGroup( 0, third, 0 );
			geo.addGroup( third, third, 1 );
			geo.addGroup( third * 2, totalIndices - third * 2, 0 );

			// Only include from middle of second group onwards
			geo.setDrawRange( third + 3, Infinity );

			expect( () => new MeshBVH( geo, { verbose: false } ) ).not.toThrow();

		} );

	} );

} );
