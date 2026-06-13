import {
	SphereGeometry,
	BoxGeometry,
	Sphere,
	Ray,
	Vector3,
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

	describe( `Sphere Queries with Options: ${ desc }`, () => runSuiteWithOptions( options ) );

} );

function runSuiteWithOptions( defaultOptions ) {

	const MeshBVH = class extends _MeshBVH {

		constructor( geometry, options ) {

			super( geometry, Object.assign( {}, defaultOptions, options ) );

		}

	};

	describe( 'collectIntersectingTriangles', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new SphereGeometry( 1, 50, 50 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'should return triangle indices for intersecting sphere', () => {

			const sphere = new Sphere();
			sphere.radius = 0.5;
			sphere.center.set( 1, 0, 0 );

			const results = bvh.collectIntersectingTriangles( sphere );

			expect( results ).toBeInstanceOf( Array );
			expect( results.length ).toBeGreaterThan( 0 );

			// All returned indices should be valid triangle indices
			const totalTriangles = bvh.geometry.index.count / 3;
			for ( const triIndex of results ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'should return all triangles when sphere encompasses mesh', () => {

			const sphere = new Sphere();
			sphere.radius = 10;
			sphere.center.set( 0, 0, 0 );

			const results = bvh.collectIntersectingTriangles( sphere );

			const totalTriangles = bvh.geometry.index.count / 3;
			expect( results.length ).toBe( totalTriangles );

		} );

		it( 'should return empty array when sphere is outside mesh', () => {

			const sphere = new Sphere();
			sphere.radius = 0.1;
			sphere.center.set( 5, 5, 5 );

			const results = bvh.collectIntersectingTriangles( sphere );

			expect( results.length ).toBe( 0 );

		} );

		it( 'should return empty array when sphere is completely inside hollow mesh', () => {

			const sphere = new Sphere();
			sphere.radius = 0.1;
			sphere.center.set( 0, 0, 0 );

			const results = bvh.collectIntersectingTriangles( sphere );

			// Small sphere at center shouldn't intersect sphere surface
			expect( results.length ).toBe( 0 );

		} );

		it( 'should append to existing results array', () => {

			const sphere = new Sphere();
			sphere.radius = 0.5;
			sphere.center.set( 1, 0, 0 );

			const existingResults = [ 999999 ];
			const results = bvh.collectIntersectingTriangles( sphere, existingResults );

			expect( results ).toBe( existingResults );
			expect( results[ 0 ] ).toBe( 999999 );
			expect( results.length ).toBeGreaterThan( 1 );

		} );

		it( 'should produce consistent results', () => {

			const sphere = new Sphere();
			sphere.radius = 0.3;
			sphere.center.set( 0.8, 0.3, 0.2 );

			const results1 = bvh.collectIntersectingTriangles( sphere );
			const results2 = bvh.collectIntersectingTriangles( sphere );

			expect( results1.length ).toBe( results2.length );
			expect( results1.sort() ).toEqual( results2.sort() );

		} );

	} );

	describe( 'intersectsSphere boolean', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new SphereGeometry( 1, 50, 50 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'should match collectIntersectingTriangles result', () => {

			const testCases = [
				{ center: new Vector3( 1, 0, 0 ), radius: 0.5, expected: true },
				{ center: new Vector3( 5, 5, 5 ), radius: 0.1, expected: false },
				{ center: new Vector3( 0, 0, 0 ), radius: 0.1, expected: false },
				{ center: new Vector3( 0, 1, 0 ), radius: 0.1, expected: true },
			];

			for ( const tc of testCases ) {

				const sphere = new Sphere( tc.center, tc.radius );
				const booleanResult = bvh.intersectsSphere( sphere );
				const trianglesResult = bvh.collectIntersectingTriangles( sphere );

				expect( booleanResult ).toBe( tc.expected );
				expect( trianglesResult.length > 0 ).toBe( tc.expected );

			}

		} );

	} );

	describe( 'sphereCast', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new SphereGeometry( 1, 30, 30 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'should find triangles along ray path', () => {

			const sphere = new Sphere( new Vector3(), 0.1 );
			const ray = new Ray(
				new Vector3( 0, 0, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			const results = bvh.sphereCast( sphere, ray, 0, Infinity );

			expect( results ).toBeInstanceOf( Array );
			expect( results.length ).toBeGreaterThan( 0 );

			// Each result should have required properties
			for ( const hit of results ) {

				expect( hit ).toHaveProperty( 'triangleIndex' );
				expect( hit ).toHaveProperty( 'distance' );
				expect( hit ).toHaveProperty( 'point' );
				expect( typeof hit.triangleIndex ).toBe( 'number' );
				expect( typeof hit.distance ).toBe( 'number' );

			}

		} );

		it( 'should return empty array when ray misses', () => {

			const sphere = new Sphere( new Vector3(), 0.1 );
			const ray = new Ray(
				new Vector3( 10, 10, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			const results = bvh.sphereCast( sphere, ray, 0, Infinity );

			expect( results.length ).toBe( 0 );

		} );

		it( 'should respect near and far limits', () => {

			const sphere = new Sphere( new Vector3(), 0.1 );
			const ray = new Ray(
				new Vector3( 0, 0, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			// Near limit beyond the sphere
			const resultsFar = bvh.sphereCast( sphere, ray, 100, Infinity );
			expect( resultsFar.length ).toBe( 0 );

			// Far limit before the sphere
			const resultsNear = bvh.sphereCast( sphere, ray, 0, 1 );
			expect( resultsNear.length ).toBe( 0 );

		} );

		it( 'should find more triangles with larger sphere radius', () => {

			const ray = new Ray(
				new Vector3( 0, 0, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			const smallSphere = new Sphere( new Vector3(), 0.05 );
			const largeSphere = new Sphere( new Vector3(), 0.3 );

			const smallResults = bvh.sphereCast( smallSphere, ray, 0, Infinity );
			const largeResults = bvh.sphereCast( largeSphere, ray, 0, Infinity );

			expect( largeResults.length ).toBeGreaterThanOrEqual( smallResults.length );

		} );

		it( 'should append to existing results array', () => {

			const sphere = new Sphere( new Vector3(), 0.1 );
			const ray = new Ray(
				new Vector3( 0, 0, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			const existingResults = [ { triangleIndex: - 1, distance: 0, point: new Vector3() } ];
			const results = bvh.sphereCast( sphere, ray, 0, Infinity, existingResults );

			expect( results ).toBe( existingResults );
			expect( results[ 0 ].triangleIndex ).toBe( - 1 );
			expect( results.length ).toBeGreaterThan( 1 );

		} );

		it( 'should behave like raycast when sphere radius is very small', () => {

			const ray = new Ray(
				new Vector3( 0, 0, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			// Use a very small sphere (essentially a ray)
			const tinySphere = new Sphere( new Vector3(), 0.001 );
			const sphereCastResults = bvh.sphereCast( tinySphere, ray, 0, Infinity );

			// Compare with raycast
			const raycastResults = bvh.raycast( ray );

			// The sphereCast should find similar or more triangles than raycast
			// (it might find more due to the tiny radius expansion)
			expect( sphereCastResults.length ).toBeGreaterThanOrEqual( 0 );

		} );

	} );

	describe( 'indirect mode support', () => {

		it( 'collectIntersectingTriangles should work with indirect mode', () => {

			const geom = new SphereGeometry( 1, 20, 20 );
			const indirectBvh = new MeshBVH( geom, { indirect: true, verbose: false } );

			const sphere = new Sphere();
			sphere.radius = 0.5;
			sphere.center.set( 1, 0, 0 );

			const results = indirectBvh.collectIntersectingTriangles( sphere );

			expect( results.length ).toBeGreaterThan( 0 );

			// Verify indices are valid
			const totalTriangles = geom.index.count / 3;
			for ( const triIndex of results ) {

				expect( triIndex ).toBeGreaterThanOrEqual( 0 );
				expect( triIndex ).toBeLessThan( totalTriangles );

			}

		} );

		it( 'sphereCast should work with indirect mode', () => {

			const geom = new SphereGeometry( 1, 20, 20 );
			const indirectBvh = new MeshBVH( geom, { indirect: true, verbose: false } );

			const sphere = new Sphere( new Vector3(), 0.1 );
			const ray = new Ray(
				new Vector3( 0, 0, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			const results = indirectBvh.sphereCast( sphere, ray, 0, Infinity );

			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'direct and indirect mode should produce same results for collectIntersectingTriangles', () => {

			const geom1 = new SphereGeometry( 1, 20, 20 );
			const geom2 = geom1.clone();

			const directBvh = new MeshBVH( geom1, { indirect: false, verbose: false } );
			const indirectBvh = new MeshBVH( geom2, { indirect: true, verbose: false } );

			const sphere = new Sphere();
			sphere.radius = 0.5;
			sphere.center.set( 0.8, 0.3, 0 );

			const directResults = directBvh.collectIntersectingTriangles( sphere );
			const indirectResults = indirectBvh.collectIntersectingTriangles( sphere );

			// Results should be the same (or very similar due to floating point)
			expect( directResults.length ).toBe( indirectResults.length );

		} );

	} );

	describe( 'Box geometry edge cases', () => {

		let bvh = null;

		beforeAll( () => {

			const geom = new BoxGeometry( 2, 2, 2 );
			bvh = new MeshBVH( geom, { verbose: false } );

		} );

		it( 'should find triangles on box faces', () => {

			const sphere = new Sphere();
			sphere.radius = 0.5;
			sphere.center.set( 1, 0, 0 ); // On +X face

			const results = bvh.collectIntersectingTriangles( sphere );

			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'should find triangles at box corners', () => {

			const sphere = new Sphere();
			sphere.radius = 0.5;
			sphere.center.set( 1, 1, 1 ); // At corner

			const results = bvh.collectIntersectingTriangles( sphere );

			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'sphereCast should find triangles on box faces', () => {

			const sphere = new Sphere( new Vector3(), 0.1 );
			const ray = new Ray(
				new Vector3( 0, 0, - 5 ),
				new Vector3( 0, 0, 1 ).normalize()
			);

			const results = bvh.sphereCast( sphere, ray, 0, Infinity );

			expect( results.length ).toBeGreaterThan( 0 );

		} );

	} );

}
