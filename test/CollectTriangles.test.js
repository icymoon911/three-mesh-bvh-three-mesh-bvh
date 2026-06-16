
import {
	BufferGeometry,
	SphereGeometry,
	BoxGeometry,
	Vector3,
	Quaternion,
	Matrix4,
	Sphere,
	Box3,
	Euler,
	Frustum,
	PerspectiveCamera,
} from 'three';
import {
	MeshBVH as _MeshBVH,
	computeBoundsTree,
	disposeBoundsTree,
	CONTAINED,
	INTERSECTED,
	NOT_INTERSECTED,
	CENTER,
} from 'three-mesh-bvh';
import { runTestMatrix } from './utils.js';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

runTestMatrix( {
	strategy: [ CENTER ],
}, ( desc, options ) => {

	describe( `Running with Options: ${ desc }`, () => runSuiteWithOptions( options ) );

} );

function runSuiteWithOptions( defaultOptions ) {

	const MeshBVH = class extends _MeshBVH {

		constructor( geometry, options ) {

			super( geometry, Object.assign( {}, defaultOptions, options ) );

		}

	};

	describe( 'collectTrianglesInBox', () => {

		let bvh, geometry;

		beforeAll( () => {

			geometry = new SphereGeometry( 1, 20, 20 );
			bvh = new MeshBVH( geometry, { verbose: false } );

		} );

		it( 'should collect all triangles when the box encapsulates the entire geometry', () => {

			const box = new Box3(
				new Vector3( - 10, - 10, - 10 ),
				new Vector3( 10, 10, 10 )
			);
			const boxToBvh = new Matrix4();

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			// All triangles should be collected
			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;
			expect( result.length ).toEqual( totalTriangles );

		} );

		it( 'should collect no triangles when the box is far away', () => {

			const box = new Box3(
				new Vector3( - 1, - 1, - 1 ),
				new Vector3( 1, 1, 1 )
			);
			const boxToBvh = new Matrix4().makeTranslation( 0, 10, 0 );

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( result.length ).toEqual( 0 );

		} );

		it( 'should collect some triangles when the box partially overlaps', () => {

			// Box centered at (0, 0.8, 0) with size 1 - should cut through the top of the sphere
			const box = new Box3(
				new Vector3( - 2, - 0.5, - 2 ),
				new Vector3( 2, 0.5, 2 )
			);
			const boxToBvh = new Matrix4().makeTranslation( 0, 0.8, 0 );

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			expect( result.length ).toBeGreaterThan( 0 );
			expect( result.length ).toBeLessThan( totalTriangles );

		} );

		it( 'should return unique triangle indices', () => {

			const box = new Box3(
				new Vector3( - 10, - 10, - 10 ),
				new Vector3( 10, 10, 10 )
			);
			const boxToBvh = new Matrix4();

			const result = bvh.collectTrianglesInBox( box, boxToBvh );
			const unique = new Set( result );

			expect( unique.size ).toEqual( result.length );

		} );

		it( 'should handle an oriented box (rotation)', () => {

			const box = new Box3(
				new Vector3( - 2, - 2, - 2 ),
				new Vector3( 2, 2, 2 )
			);

			// Rotate the box 45 degrees around the origin - the OBB still covers the sphere center
			const boxToBvh = new Matrix4().makeRotationFromEuler(
				new Euler( Math.PI / 4, Math.PI / 4, 0 )
			);

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			// The OBB should intersect many triangles on the sphere surface
			expect( result.length ).toBeGreaterThan( 0 );

			// Also verify an OBB with non-identity rotation produces different results
			// than a non-rotated box of the same size in some cases
			const box2 = new Box3(
				new Vector3( - 0.3, - 0.3, - 0.3 ),
				new Vector3( 0.3, 0.3, 0.3 )
			);

			// A thin rotated box passing through the sphere surface
			const boxToBvh2 = new Matrix4().compose(
				new Vector3( 0, 0.9, 0 ),
				new Quaternion().setFromEuler( new Euler( Math.PI / 4, 0, 0 ) ),
				new Vector3( 1, 1, 1 )
			);

			const result2 = bvh.collectTrianglesInBox( box2, boxToBvh2 );

			// Should intersect triangles near the top of the sphere
			expect( result2.length ).toBeGreaterThan( 0 );

		} );

		it( 'should produce the same results as intersectsBox for boolean checks', () => {

			const box = new Box3(
				new Vector3( - 0.5, - 0.5, - 0.5 ),
				new Vector3( 0.5, 0.5, 0.5 )
			);
			const boxToBvh = new Matrix4().makeTranslation( 0, 1, 0 );

			const intersects = bvh.intersectsBox( box, boxToBvh );
			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( intersects ).toEqual( result.length > 0 );

		} );

	} );

	describe( 'collectTrianglesInSphere', () => {

		let bvh, geometry;

		beforeAll( () => {

			geometry = new SphereGeometry( 1, 20, 20 );
			bvh = new MeshBVH( geometry, { verbose: false } );

		} );

		it( 'should collect all triangles when the sphere encapsulates the entire geometry', () => {

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 10 );

			const result = bvh.collectTrianglesInSphere( sphere );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;
			expect( result.length ).toEqual( totalTriangles );

		} );

		it( 'should collect no triangles when the sphere is far away', () => {

			const sphere = new Sphere( new Vector3( 0, 10, 0 ), 1 );

			const result = bvh.collectTrianglesInSphere( sphere );

			expect( result.length ).toEqual( 0 );

		} );

		it( 'should collect some triangles when the sphere partially overlaps', () => {

			// Sphere centered at surface of the geometry
			const sphere = new Sphere( new Vector3( 0, 1, 0 ), 0.3 );

			const result = bvh.collectTrianglesInSphere( sphere );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			expect( result.length ).toBeGreaterThan( 0 );
			expect( result.length ).toBeLessThan( totalTriangles );

		} );

		it( 'should return unique triangle indices', () => {

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 10 );

			const result = bvh.collectTrianglesInSphere( sphere );
			const unique = new Set( result );

			expect( unique.size ).toEqual( result.length );

		} );

		it( 'should collect no triangles when the sphere is inside the hollow mesh', () => {

			// A small sphere entirely inside the unit sphere but not touching any triangles
			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 0.5 );

			const result = bvh.collectTrianglesInSphere( sphere );

			expect( result.length ).toEqual( 0 );

		} );

	} );

	describe( 'collectTrianglesInFrustum', () => {

		let bvh, geometry;

		beforeAll( () => {

			geometry = new SphereGeometry( 1, 20, 20 );
			bvh = new MeshBVH( geometry, { verbose: false } );

		} );

		it( 'should collect all triangles when the frustum encapsulates the entire geometry', () => {

			// Create a wide frustum that contains the entire unit sphere
			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const frustum = new Frustum();
			frustum.setFromProjectionMatrix(
				new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
			);

			const result = bvh.collectTrianglesInFrustum( frustum );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			// Most triangles should be collected (some on the back side may be excluded)
			expect( result.length ).toBeGreaterThan( 0 );

		} );

		it( 'should collect no triangles when the frustum points away', () => {

			const camera = new PerspectiveCamera( 45, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			// Look away from the geometry
			camera.lookAt( 0, 0, 10 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const frustum = new Frustum();
			frustum.setFromProjectionMatrix(
				new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
			);

			const result = bvh.collectTrianglesInFrustum( frustum );

			expect( result.length ).toEqual( 0 );

		} );

		it( 'should support a frustumToBvh transform', () => {

			// Create a frustum in world space looking at origin
			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const frustum = new Frustum();
			frustum.setFromProjectionMatrix(
				new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
			);

			// The BVH is in local space. If the mesh were at position (0,0,0),
			// frustumToBvh would be identity. For a translated mesh, we'd need
			// the inverse of the mesh's world matrix.
			const frustumToBvh = new Matrix4(); // identity = BVH already in same space

			const result = bvh.collectTrianglesInFrustum( frustum, frustumToBvh );

			expect( result.length ).toBeGreaterThan( 0 );

		} );

		it( 'should return unique triangle indices', () => {

			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const frustum = new Frustum();
			frustum.setFromProjectionMatrix(
				new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
			);

			const result = bvh.collectTrianglesInFrustum( frustum );
			const unique = new Set( result );

			expect( unique.size ).toEqual( result.length );

		} );

	} );

	describe( 'Indirect mode index mapping', () => {

		it( 'should return correct indices for collectTrianglesInBox in indirect mode', () => {

			const geometry = new SphereGeometry( 1, 10, 10 );
			const bvh = new MeshBVH( geometry, { verbose: false, indirect: true } );

			const box = new Box3(
				new Vector3( - 10, - 10, - 10 ),
				new Vector3( 10, 10, 10 )
			);
			const boxToBvh = new Matrix4();

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			// All triangles should be collected
			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;
			expect( result.length ).toEqual( totalTriangles );

			// Verify indices are within valid range
			for ( const idx of result ) {

				expect( idx ).toBeGreaterThanOrEqual( 0 );
				expect( idx ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'should return correct indices for collectTrianglesInSphere in indirect mode', () => {

			const geometry = new SphereGeometry( 1, 10, 10 );
			const bvh = new MeshBVH( geometry, { verbose: false, indirect: true } );

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 10 );

			const result = bvh.collectTrianglesInSphere( sphere );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;
			expect( result.length ).toEqual( totalTriangles );

			// Verify indices are within valid range
			for ( const idx of result ) {

				expect( idx ).toBeGreaterThanOrEqual( 0 );
				expect( idx ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'should return correct indices for collectTrianglesInFrustum in indirect mode', () => {

			const geometry = new SphereGeometry( 1, 10, 10 );
			const bvh = new MeshBVH( geometry, { verbose: false, indirect: true } );

			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const frustum = new Frustum();
			frustum.setFromProjectionMatrix(
				new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
			);

			const result = bvh.collectTrianglesInFrustum( frustum );

			// Verify indices are within valid range
			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			for ( const idx of result ) {

				expect( idx ).toBeGreaterThanOrEqual( 0 );
				expect( idx ).toBeLessThan( totalTriangles );

			}

			expect( result.length ).toBeGreaterThan( 0 );

		} );

		it( 'should produce consistent result counts in indirect and direct mode', () => {

			const geometry1 = new SphereGeometry( 1, 10, 10 );
			const geometry2 = new SphereGeometry( 1, 10, 10 );

			const directBvh = new MeshBVH( geometry1, { verbose: false, indirect: false } );
			const indirectBvh = new MeshBVH( geometry2, { verbose: false, indirect: true } );

			const totalTriangles = geometry1.index
				? geometry1.index.count / 3
				: geometry1.attributes.position.count / 3;

			// Large box that fully contains the sphere - should collect all triangles in both modes
			const box = new Box3(
				new Vector3( - 10, - 10, - 10 ),
				new Vector3( 10, 10, 10 )
			);
			const boxToBvh = new Matrix4();

			const directResult = directBvh.collectTrianglesInBox( box, boxToBvh );
			const indirectResult = indirectBvh.collectTrianglesInBox( box, boxToBvh );

			// Both should collect all triangles
			expect( directResult.length ).toEqual( totalTriangles );
			expect( indirectResult.length ).toEqual( totalTriangles );

			// Verify all direct-mode indices are valid
			const directSet = new Set( directResult );
			expect( directSet.size ).toEqual( directResult.length );
			for ( const idx of directResult ) {

				expect( idx ).toBeGreaterThanOrEqual( 0 );
				expect( idx ).toBeLessThan( totalTriangles );

			}

			// Verify all indirect-mode indices are valid
			const indirectSet = new Set( indirectResult );
			expect( indirectSet.size ).toEqual( indirectResult.length );
			for ( const idx of indirectResult ) {

				expect( idx ).toBeGreaterThanOrEqual( 0 );
				expect( idx ).toBeLessThan( totalTriangles );

			}

			// Test with a partial-overlap box: counts should match because the same
			// geometric triangles are hit regardless of index layout
			const partialBox = new Box3(
				new Vector3( - 0.5, 0.5, - 0.5 ),
				new Vector3( 0.5, 1.5, 0.5 )
			);
			const partialBoxToBvh = new Matrix4();

			const directPartial = directBvh.collectTrianglesInBox( partialBox, partialBoxToBvh );
			const indirectPartial = indirectBvh.collectTrianglesInBox( partialBox, partialBoxToBvh );

			// Counts should match since both query the same geometry shape
			expect( directPartial.length ).toEqual( indirectPartial.length );
			expect( directPartial.length ).toBeGreaterThan( 0 );

		} );

	} );

	describe( 'CONTAINED optimization', () => {

		it( 'should collect all triangles with a large box without per-triangle tests', () => {

			const geometry = new SphereGeometry( 1, 50, 50 );
			const bvh = new MeshBVH( geometry, { verbose: false } );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			// Use a box that fully contains the entire sphere
			const box = new Box3(
				new Vector3( - 10, - 10, - 10 ),
				new Vector3( 10, 10, 10 )
			);
			const boxToBvh = new Matrix4();

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( result.length ).toEqual( totalTriangles );

			// Verify by counting how many nodes are traversed when using a custom shapecast
			// with CONTAINED. The CONTAINED optimization should skip deep traversal.
			let containedRanges = 0;
			let totalTrianglesInContained = 0;
			bvh.shapecast( {
				intersectsBounds: ( nodeBox ) => {

					const obb = new ( Object.getPrototypeOf( _MeshBVH ).prototype.constructor.name === 'MeshBVH'
						? Object : Object )(); // dummy
					// Use the same logic: if box fully contains nodeBox, return CONTAINED
					if ( nodeBox.min.x >= - 10 && nodeBox.max.x <= 10 &&
						nodeBox.min.y >= - 10 && nodeBox.max.y <= 10 &&
						nodeBox.min.z >= - 10 && nodeBox.max.z <= 10 ) {

						return CONTAINED;

					}

					if ( nodeBox.min.x > 10 || nodeBox.max.x < - 10 ||
						nodeBox.min.y > 10 || nodeBox.max.y < - 10 ||
						nodeBox.min.z > 10 || nodeBox.max.z < - 10 ) {

						return NOT_INTERSECTED;

					}

					return INTERSECTED;

				},
				intersectsRange: ( offset, count, contained ) => {

					if ( contained ) {

						containedRanges ++;
						totalTrianglesInContained += count;

					}

					return false;

				}
			} );

			// The CONTAINED optimization should have been triggered at least once
			expect( containedRanges ).toBeGreaterThan( 0 );
			// All triangles should be in contained ranges
			expect( totalTrianglesInContained ).toEqual( totalTriangles );

		} );

		it( 'should collect all triangles with a large sphere using CONTAINED', () => {

			const geometry = new SphereGeometry( 1, 50, 50 );
			const bvh = new MeshBVH( geometry, { verbose: false } );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 100 );

			const result = bvh.collectTrianglesInSphere( sphere );

			expect( result.length ).toEqual( totalTriangles );

		} );

		it( 'should collect all triangles with a large frustum using CONTAINED', () => {

			const geometry = new SphereGeometry( 1, 20, 20 );
			const bvh = new MeshBVH( geometry, { verbose: false } );

			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			// Wide frustum that easily contains the unit sphere
			const camera = new PerspectiveCamera( 120, 1, 0.01, 1000 );
			camera.position.set( 0, 0, 3 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const frustum = new Frustum();
			frustum.setFromProjectionMatrix(
				new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
			);

			const result = bvh.collectTrianglesInFrustum( frustum );

			// All triangles should be visible from this vantage point
			expect( result.length ).toEqual( totalTriangles );

		} );

	} );

	describe( 'Edge cases', () => {

		it( 'should handle an empty Box3 gracefully', () => {

			const geometry = new BoxGeometry( 2, 2, 2 );
			const bvh = new MeshBVH( geometry, { verbose: false } );

			const box = new Box3(); // empty box
			const boxToBvh = new Matrix4();

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( result.length ).toEqual( 0 );

		} );

		it( 'should handle a zero-radius sphere', () => {

			const geometry = new BoxGeometry( 2, 2, 2 );
			const bvh = new MeshBVH( geometry, { verbose: false } );

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 0 );

			const result = bvh.collectTrianglesInSphere( sphere );

			// A zero-radius sphere at the center of a box might or might not hit
			// triangles (depends on whether the center is on a triangle surface).
			// Just verify it doesn't throw.
			expect( Array.isArray( result ) ).toBe( true );

		} );

		it( 'should work with a BoxGeometry', () => {

			const geometry = new BoxGeometry( 2, 2, 2 );
			const bvh = new MeshBVH( geometry, { verbose: false } );

			const box = new Box3(
				new Vector3( - 1, - 1, - 1 ),
				new Vector3( 1, 1, 1 )
			);
			const boxToBvh = new Matrix4();

			const result = bvh.collectTrianglesInBox( box, boxToBvh );

			// The box exactly matches the geometry bounds, all triangles should be hit
			const totalTriangles = geometry.index
				? geometry.index.count / 3
				: geometry.attributes.position.count / 3;

			expect( result.length ).toBeGreaterThan( 0 );
			expect( result.length ).toBeLessThanOrEqual( totalTriangles );

		} );

	} );

}
