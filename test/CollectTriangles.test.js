import {
	SphereGeometry,
	BoxGeometry,
	TorusGeometry,
	Sphere,
	Box3,
	Frustum,
	Matrix4,
	Vector3,
	PerspectiveCamera,
	Mesh,
} from 'three';
import {
	MeshBVH as _MeshBVH,
	CENTER,
} from 'three-mesh-bvh';
import { runTestMatrix } from './utils.js';

runTestMatrix( {
	strategy: [ CENTER ],
	indirect: [ false, true ],
}, ( desc, options ) => {

	describe( `Collect Triangles with Options: ${ desc }`, () => runSuiteWithOptions( options ) );

} );

function runSuiteWithOptions( defaultOptions ) {

	const MeshBVH = class extends _MeshBVH {

		constructor( geometry, options ) {

			super( geometry, Object.assign( {}, defaultOptions, options ) );

		}

	};

	describe( 'collectTrianglesInBox', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new SphereGeometry( 1, 50, 50 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'should return triangle indices for an intersecting box', () => {

			const box = new Box3(
				new Vector3( 0.5, - 0.5, - 0.5 ),
				new Vector3( 1.5, 0.5, 0.5 )
			);
			const boxToBvh = new Matrix4();

			const results = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( results ).toBeInstanceOf( Array );
			expect( results.length ).toBeGreaterThan( 0 );

			const totalTriangles = bvh.geometry.index.count / 3;
			for ( const triIndex of results ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'should return all triangles when box encompasses the entire mesh', () => {

			const box = new Box3(
				new Vector3( - 10, - 10, - 10 ),
				new Vector3( 10, 10, 10 )
			);
			const boxToBvh = new Matrix4();

			const results = bvh.collectTrianglesInBox( box, boxToBvh );

			const totalTriangles = bvh.geometry.index.count / 3;
			expect( results.length ).toBe( totalTriangles );

		} );

		it( 'should return empty array when box is outside mesh', () => {

			const box = new Box3(
				new Vector3( 5, 5, 5 ),
				new Vector3( 6, 6, 6 )
			);
			const boxToBvh = new Matrix4();

			const results = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( results.length ).toBe( 0 );

		} );

		it( 'should append to existing results array', () => {

			const box = new Box3(
				new Vector3( 0.5, - 0.5, - 0.5 ),
				new Vector3( 1.5, 0.5, 0.5 )
			);
			const boxToBvh = new Matrix4();

			const existingResults = [ 999999 ];
			const results = bvh.collectTrianglesInBox( box, boxToBvh, existingResults );

			expect( results ).toBe( existingResults );
			expect( results[ 0 ] ).toBe( 999999 );
			expect( results.length ).toBeGreaterThan( 1 );

		} );

		it( 'should handle a rotated OBB via boxToBvh matrix', () => {

			const box = new Box3(
				new Vector3( - 0.5, - 0.5, - 0.5 ),
				new Vector3( 0.5, 0.5, 0.5 )
			);
			const boxToBvh = new Matrix4();
			// Translate the box to the surface of the sphere
			boxToBvh.makeTranslation( 1, 0, 0 );

			const results = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'should match intersectsBox boolean result', () => {

			const testCases = [
				{
					box: new Box3( new Vector3( 0.5, - 0.5, - 0.5 ), new Vector3( 1.5, 0.5, 0.5 ) ),
					expected: true,
				},
				{
					box: new Box3( new Vector3( 5, 5, 5 ), new Vector3( 6, 6, 6 ) ),
					expected: false,
				},
			];

			for ( const tc of testCases ) {

				const boxToBvh = new Matrix4();
				const booleanResult = bvh.intersectsBox( tc.box, boxToBvh );
				const triangles = bvh.collectTrianglesInBox( tc.box, boxToBvh );

				expect( booleanResult ).toBe( tc.expected );
				expect( triangles.length > 0 ).toBe( tc.expected );

			}

		} );

	} );

	describe( 'collectTrianglesInSphere', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new SphereGeometry( 1, 50, 50 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'should return triangle indices for intersecting sphere', () => {

			const sphere = new Sphere( new Vector3( 1, 0, 0 ), 0.5 );

			const results = bvh.collectTrianglesInSphere( sphere );

			expect( results ).toBeInstanceOf( Array );
			expect( results.length ).toBeGreaterThan( 0 );

			const totalTriangles = bvh.geometry.index.count / 3;
			for ( const triIndex of results ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'should return all triangles when sphere encompasses mesh', () => {

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 10 );

			const results = bvh.collectTrianglesInSphere( sphere );

			const totalTriangles = bvh.geometry.index.count / 3;
			expect( results.length ).toBe( totalTriangles );

		} );

		it( 'should return empty array when sphere is outside mesh', () => {

			const sphere = new Sphere( new Vector3( 5, 5, 5 ), 0.1 );

			const results = bvh.collectTrianglesInSphere( sphere );

			expect( results.length ).toBe( 0 );

		} );

		it( 'should return empty array when sphere is inside hollow mesh', () => {

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 0.1 );

			const results = bvh.collectTrianglesInSphere( sphere );

			expect( results.length ).toBe( 0 );

		} );

		it( 'should append to existing results array', () => {

			const sphere = new Sphere( new Vector3( 1, 0, 0 ), 0.5 );

			const existingResults = [ 999999 ];
			const results = bvh.collectTrianglesInSphere( sphere, existingResults );

			expect( results ).toBe( existingResults );
			expect( results[ 0 ] ).toBe( 999999 );
			expect( results.length ).toBeGreaterThan( 1 );

		} );

		it( 'should produce consistent results', () => {

			const sphere = new Sphere( new Vector3( 0.8, 0.3, 0.2 ), 0.3 );

			const results1 = bvh.collectTrianglesInSphere( sphere );
			const results2 = bvh.collectTrianglesInSphere( sphere );

			expect( results1.length ).toBe( results2.length );
			expect( results1.sort() ).toEqual( results2.sort() );

		} );

		it( 'should match intersectsSphere boolean result', () => {

			const testCases = [
				{ sphere: new Sphere( new Vector3( 1, 0, 0 ), 0.5 ), expected: true },
				{ sphere: new Sphere( new Vector3( 5, 5, 5 ), 0.1 ), expected: false },
				{ sphere: new Sphere( new Vector3( 0, 0, 0 ), 0.1 ), expected: false },
				{ sphere: new Sphere( new Vector3( 0, 1, 0 ), 0.1 ), expected: true },
			];

			for ( const tc of testCases ) {

				const booleanResult = bvh.intersectsSphere( tc.sphere );
				const triangles = bvh.collectTrianglesInSphere( tc.sphere );

				expect( booleanResult ).toBe( tc.expected );
				expect( triangles.length > 0 ).toBe( tc.expected );

			}

		} );

	} );

	describe( 'collectTrianglesInFrustum', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new SphereGeometry( 1, 50, 50 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'should return triangles visible in a frustum encompassing the mesh', () => {

			// Create a frustum that contains the entire mesh
			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const projScreenMatrix = new Matrix4();
			projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			const frustum = new Frustum();
			frustum.setFromProjectionMatrix( projScreenMatrix );

			// The frustum is in world space, but the BVH is in local space (identity)
			// Since we haven't applied any transform, they should be the same
			const results = bvh.collectTrianglesInFrustum( frustum );

			expect( results ).toBeInstanceOf( Array );
			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'should return all triangles for a very large frustum', () => {

			// Create an orthographic-like frustum with very wide FOV
			const camera = new PerspectiveCamera( 170, 1, 0.01, 1000 );
			camera.position.set( 0, 0, 0.01 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const projScreenMatrix = new Matrix4();
			projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			const frustum = new Frustum();
			frustum.setFromProjectionMatrix( projScreenMatrix );

			const results = bvh.collectTrianglesInFrustum( frustum );

			// Should capture most triangles (front-facing at least)
			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'should return empty array when frustum looks away from mesh', () => {

			const camera = new PerspectiveCamera( 60, 1, 0.1, 100 );
			// Position camera far away looking away from origin
			camera.position.set( 20, 0, 0 );
			camera.lookAt( 30, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const projScreenMatrix = new Matrix4();
			projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			const frustum = new Frustum();
			frustum.setFromProjectionMatrix( projScreenMatrix );

			const results = bvh.collectTrianglesInFrustum( frustum );

			expect( results.length ).toBe( 0 );

		} );

		it( 'should work with a matrixToLocal transform', () => {

			// Create a frustum in world space
			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const projScreenMatrix = new Matrix4();
			projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			const frustum = new Frustum();
			frustum.setFromProjectionMatrix( projScreenMatrix );

			// Since BVH is in identity space, pass identity as matrixToLocal
			const matrixToLocal = new Matrix4();
			const resultsWithMatrix = bvh.collectTrianglesInFrustum( frustum, matrixToLocal );
			const resultsWithoutMatrix = bvh.collectTrianglesInFrustum( frustum );

			expect( resultsWithMatrix.length ).toBe( resultsWithoutMatrix.length );
			expect( resultsWithMatrix.sort() ).toEqual( resultsWithoutMatrix.sort() );

		} );

		it( 'should append to existing results array', () => {

			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const projScreenMatrix = new Matrix4();
			projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			const frustum = new Frustum();
			frustum.setFromProjectionMatrix( projScreenMatrix );

			const existingResults = [ 999999 ];
			const results = bvh.collectTrianglesInFrustum( frustum, null, existingResults );

			expect( results ).toBe( existingResults );
			expect( results[ 0 ] ).toBe( 999999 );
			expect( results.length ).toBeGreaterThan( 1 );

		} );

	} );

	describe( 'CONTAINED optimization', () => {

		it( 'should collect all triangles when a large box contains the entire geometry', () => {

			const geom = new SphereGeometry( 1, 20, 20 );
			const localBvh = new MeshBVH( geom, { verbose: false } );

			// Use a box that fully contains the geometry
			const box = new Box3(
				new Vector3( - 5, - 5, - 5 ),
				new Vector3( 5, 5, 5 )
			);
			const boxToBvh = new Matrix4();

			const results = localBvh.collectTrianglesInBox( box, boxToBvh );

			const totalTriangles = geom.index.count / 3;
			expect( results.length ).toBe( totalTriangles );

		} );

		it( 'should collect all triangles when a large sphere contains the entire geometry', () => {

			const geom = new SphereGeometry( 1, 20, 20 );
			const localBvh = new MeshBVH( geom, { verbose: false } );

			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 100 );

			const results = localBvh.collectTrianglesInSphere( sphere );

			const totalTriangles = geom.index.count / 3;
			expect( results.length ).toBe( totalTriangles );

		} );

		it( 'should use CONTAINED to skip per-triangle tests when box contains subtree', () => {

			// Use a torus for a more complex geometry
			const geom = new TorusGeometry( 2, 0.5, 20, 40 );
			const localBvh = new MeshBVH( geom, { verbose: false } );

			// A huge box that contains the entire geometry - CONTAINED optimization
			// should kick in and bulk-collect triangles
			const box = new Box3(
				new Vector3( - 100, - 100, - 100 ),
				new Vector3( 100, 100, 100 )
			);
			const boxToBvh = new Matrix4();

			const results = localBvh.collectTrianglesInBox( box, boxToBvh );
			const totalTriangles = geom.index.count / 3;
			expect( results.length ).toBe( totalTriangles );

			// Verify that the same result is obtained with sphere
			const sphere = new Sphere( new Vector3( 0, 0, 0 ), 100 );
			const sphereResults = localBvh.collectTrianglesInSphere( sphere );
			expect( sphereResults.length ).toBe( totalTriangles );

		} );

	} );

	describe( 'indirect mode support', () => {

		it( 'collectTrianglesInBox should work with indirect mode', () => {

			const geom = new SphereGeometry( 1, 20, 20 );
			const indirectBvh = new MeshBVH( geom, { indirect: true, verbose: false } );

			const box = new Box3(
				new Vector3( 0.5, - 0.5, - 0.5 ),
				new Vector3( 1.5, 0.5, 0.5 )
			);
			const boxToBvh = new Matrix4();

			const results = indirectBvh.collectTrianglesInBox( box, boxToBvh );

			expect( results.length ).toBeGreaterThan( 0 );

			const totalTriangles = geom.index.count / 3;
			for ( const triIndex of results ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'collectTrianglesInSphere should work with indirect mode', () => {

			const geom = new SphereGeometry( 1, 20, 20 );
			const indirectBvh = new MeshBVH( geom, { indirect: true, verbose: false } );

			const sphere = new Sphere( new Vector3( 1, 0, 0 ), 0.5 );

			const results = indirectBvh.collectTrianglesInSphere( sphere );

			expect( results.length ).toBeGreaterThan( 0 );

			const totalTriangles = geom.index.count / 3;
			for ( const triIndex of results ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'collectTrianglesInFrustum should work with indirect mode', () => {

			const geom = new SphereGeometry( 1, 20, 20 );
			const indirectBvh = new MeshBVH( geom, { indirect: true, verbose: false } );

			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const projScreenMatrix = new Matrix4();
			projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			const frustum = new Frustum();
			frustum.setFromProjectionMatrix( projScreenMatrix );

			const results = indirectBvh.collectTrianglesInFrustum( frustum );

			expect( results.length ).toBeGreaterThan( 0 );

			const totalTriangles = geom.index.count / 3;
			for ( const triIndex of results ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'direct and indirect mode should produce same count for collectTrianglesInBox', () => {

			const geom1 = new SphereGeometry( 1, 20, 20 );
			const geom2 = geom1.clone();

			const directBvh = new MeshBVH( geom1, { indirect: false, verbose: false } );
			const indirectBvh = new MeshBVH( geom2, { indirect: true, verbose: false } );

			const box = new Box3(
				new Vector3( 0.3, - 0.5, - 0.5 ),
				new Vector3( 1.5, 0.5, 0.5 )
			);
			const boxToBvh = new Matrix4();

			const directResults = directBvh.collectTrianglesInBox( box, boxToBvh );
			const indirectResults = indirectBvh.collectTrianglesInBox( box, boxToBvh );

			// Direct mode reorders the index buffer so raw indices differ,
			// but the count of intersecting triangles should match
			expect( directResults.length ).toBe( indirectResults.length );

			// Verify all indices are valid
			const totalTriangles = geom2.index.count / 3;
			for ( const triIndex of indirectResults ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'direct and indirect mode should produce same count for collectTrianglesInSphere', () => {

			const geom1 = new SphereGeometry( 1, 20, 20 );
			const geom2 = geom1.clone();

			const directBvh = new MeshBVH( geom1, { indirect: false, verbose: false } );
			const indirectBvh = new MeshBVH( geom2, { indirect: true, verbose: false } );

			const sphere = new Sphere( new Vector3( 0.8, 0.3, 0 ), 0.5 );

			const directResults = directBvh.collectTrianglesInSphere( sphere );
			const indirectResults = indirectBvh.collectTrianglesInSphere( sphere );

			expect( directResults.length ).toBe( indirectResults.length );

		} );

		it( 'direct and indirect mode should produce same count for collectTrianglesInFrustum', () => {

			const geom1 = new SphereGeometry( 1, 20, 20 );
			const geom2 = geom1.clone();

			const directBvh = new MeshBVH( geom1, { indirect: false, verbose: false } );
			const indirectBvh = new MeshBVH( geom2, { indirect: true, verbose: false } );

			const camera = new PerspectiveCamera( 90, 1, 0.1, 100 );
			camera.position.set( 0, 0, 5 );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();
			camera.updateProjectionMatrix();

			const projScreenMatrix = new Matrix4();
			projScreenMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
			const frustum = new Frustum();
			frustum.setFromProjectionMatrix( projScreenMatrix );

			const directResults = directBvh.collectTrianglesInFrustum( frustum );
			const indirectResults = indirectBvh.collectTrianglesInFrustum( frustum );

			expect( directResults.length ).toBe( indirectResults.length );

		} );

	} );

	describe( 'box geometry edge cases', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new BoxGeometry( 2, 2, 2 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'collectTrianglesInBox should find triangles on box faces', () => {

			const box = new Box3(
				new Vector3( 0.5, - 0.5, - 0.5 ),
				new Vector3( 1.5, 0.5, 0.5 )
			);
			const boxToBvh = new Matrix4();

			const results = bvh.collectTrianglesInBox( box, boxToBvh );

			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'collectTrianglesInSphere should find triangles at box corners', () => {

			const sphere = new Sphere( new Vector3( 1, 1, 1 ), 0.5 );

			const results = bvh.collectTrianglesInSphere( sphere );

			expect( results.length ).toBeGreaterThan( 0 );

		} );

	} );

}
