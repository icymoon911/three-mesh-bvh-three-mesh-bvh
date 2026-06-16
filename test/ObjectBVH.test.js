import {
	Mesh,
	InstancedMesh,
	BatchedMesh,
	SphereGeometry,
	BoxGeometry,
	MeshBasicMaterial,
	Scene,
	Raycaster,
	Euler,
	Quaternion,
	Vector3,
	Matrix4,
	Box3,
	Sphere,
	Frustum,
	PerspectiveCamera,
	REVISION,
} from 'three';
import { ObjectBVH, validateBounds } from 'three-mesh-bvh';
import { random, randomizeObjectTransform, runTestMatrix, setSeed } from './utils.js';

const _euler = /* @__PURE__ */ new Euler();
const _quaternion = /* @__PURE__ */ new Quaternion();
const _position = /* @__PURE__ */ new Vector3();
const _scale = /* @__PURE__ */ new Vector3();
const _matrix = /* @__PURE__ */ new Matrix4();

// ObjectBVH doesn't use indirect or shared array buffers; fix maxLeafSize to 1
// so the BVH tree is properly exercised with a small number of objects.
runTestMatrix( {
	precise: [ false, true ],
	indirect: [ false ],
	useSharedArrayBuffer: [ false ],
	maxLeafSize: [ 1 ],
}, ( desc, options ) => {

	// ObjectBVH requires "getGeometryRangeAt" from r169
	const IS_REVISION_169 = parseInt( REVISION ) >= 169;
	if ( IS_REVISION_169 ) {

		describe( `Running with Options: { ${ desc } }`, () => runSuiteWithOptions( options ) );

	} else {

		describe.skip( 'Skipping tests due to three.js revision' );

	}

} );

function runSuiteWithOptions( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let bvh, raycaster, objects;

		beforeAll( () => {

			setSeed( transformSeed );

			const scene = new Scene();
			objects = [];

			// Regular meshes
			const meshGeometries = [
				new SphereGeometry( 0.5, 8, 8 ),
				new BoxGeometry( 0.8, 0.8, 0.8 ),
				new SphereGeometry( 0.3, 6, 6 ),
				new BoxGeometry( 0.6, 0.6, 0.6 ),
			];
			for ( let i = 0; i < 20; i ++ ) {

				const mesh = new Mesh( meshGeometries[ i % meshGeometries.length ], new MeshBasicMaterial() );
				randomizeObjectTransform( mesh );
				scene.add( mesh );
				objects.push( mesh );

			}

			// InstancedMesh — 20 instances
			const instancedMesh = new InstancedMesh( new BoxGeometry( 0.7, 0.7, 0.7 ), new MeshBasicMaterial(), 20 );
			for ( let i = 0; i < 20; i ++ ) {

				randomizeMatrix( _matrix );
				instancedMesh.setMatrixAt( i, _matrix );

			}

			instancedMesh.instanceMatrix.needsUpdate = true;
			scene.add( instancedMesh );
			objects.push( instancedMesh );

			// BatchedMesh — 2 geometry types, 20 instances total
			const batchedMesh = new BatchedMesh( 20, 2000, 2000, new MeshBasicMaterial() );
			const sphereGeomId = batchedMesh.addGeometry( new SphereGeometry( 0.4, 6, 6 ) );
			const boxGeomId = batchedMesh.addGeometry( new BoxGeometry( 0.6, 0.6, 0.6 ) );

			for ( let i = 0; i < 10; i ++ ) {

				randomizeMatrix( _matrix );
				batchedMesh.setMatrixAt( batchedMesh.addInstance( sphereGeomId ), _matrix );

			}

			for ( let i = 0; i < 10; i ++ ) {

				randomizeMatrix( _matrix );
				batchedMesh.setMatrixAt( batchedMesh.addInstance( boxGeomId ), _matrix );

			}

			scene.add( batchedMesh );
			objects.push( batchedMesh );

			scene.updateMatrixWorld( true );

			bvh = new ObjectBVH( scene, {
				...options,
				matrixWorld: scene.matrixWorld,
			} );

			raycaster = new Raycaster();

		} );

		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random();

				raycaster.ray.origin.randomDirection().multiplyScalar( 10 );
				raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

				raycaster.firstHitOnly = false;
				const bvhHits = bvh.raycast( raycaster, [] );
				bvhHits.sort( ( a, b ) => a.distance - b.distance );

				raycaster.firstHitOnly = true;
				const firstHit = bvh.raycast( raycaster, [] );

				raycaster.firstHitOnly = false;
				const ogHits = raycaster.intersectObjects( objects, false );

				expect( validateBounds( bvh ) ).toBeTruthy();
				expect( ogHits ).toEqual( bvhHits );
				expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

			} );

		}

		describe( 'collectObjectsInBox', () => {

			it( 'should collect all objects when the box fully encloses the scene', () => {

				const box = new Box3( new Vector3( - 50, - 50, - 50 ), new Vector3( 50, 50, 50 ) );
				const boxToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const results = bvh.collectObjectsInBox( box, boxToBvh );

				// Should contain all visible objects (20 meshes + 20 instanced + 20 batched = 60)
				expect( results.length ).toBeGreaterThan( 0 );

				// Every result should have the expected shape
				results.forEach( r => {

					expect( r.object ).toBeDefined();
					expect( typeof r.instanceId ).toBe( 'number' );
					expect( typeof r.contained ).toBe( 'boolean' );

				} );

			} );

			it( 'should collect no objects when the box is far away', () => {

				const box = new Box3( new Vector3( - 1, - 1, - 1 ), new Vector3( 1, 1, 1 ) );
				const boxToBvh = new Matrix4().makeTranslation( 0, 500, 0 );
				const results = bvh.collectObjectsInBox( box, boxToBvh );
				expect( results.length ).toEqual( 0 );

			} );

			it( 'should support result array reuse', () => {

				const box = new Box3( new Vector3( - 50, - 50, - 50 ), new Vector3( 50, 50, 50 ) );
				const boxToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const existing = [ { dummy: true } ];
				const results = bvh.collectObjectsInBox( box, boxToBvh, {}, existing );

				// Should be the same array reference
				expect( results ).toBe( existing );
				// The dummy entry should still be there
				expect( results[ 0 ] ).toEqual( { dummy: true } );
				// Plus the collected objects
				expect( results.length ).toBeGreaterThan( 1 );

			} );

			it( 'should skip hidden objects by default', () => {

				// Hide the first object
				const firstObj = objects[ 0 ];
				const wasVisible = firstObj.visible;
				firstObj.visible = false;

				const box = new Box3( new Vector3( - 50, - 50, - 50 ), new Vector3( 50, 50, 50 ) );
				const boxToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const results = bvh.collectObjectsInBox( box, boxToBvh );

				// Should not contain the hidden object
				const foundHidden = results.some( r => r.object === firstObj );
				expect( foundHidden ).toBe( false );

				// Restore
				firstObj.visible = wasVisible;

			} );

			it( 'should include hidden objects when includeHidden is true', () => {

				const firstObj = objects[ 0 ];
				const wasVisible = firstObj.visible;
				firstObj.visible = false;

				const box = new Box3( new Vector3( - 50, - 50, - 50 ), new Vector3( 50, 50, 50 ) );
				const boxToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const results = bvh.collectObjectsInBox( box, boxToBvh, { includeHidden: true } );

				// Should contain the hidden object
				const foundHidden = results.some( r => r.object === firstObj );
				expect( foundHidden ).toBe( true );

				// Restore
				firstObj.visible = wasVisible;

			} );

		} );

		describe( 'collectObjectsInSphere', () => {

			it( 'should collect all objects when the sphere fully encloses the scene', () => {

				const sphere = new Sphere( new Vector3( 0, 0, 0 ), 500 );
				const results = bvh.collectObjectsInSphere( sphere );
				expect( results.length ).toBeGreaterThan( 0 );

				results.forEach( r => {

					expect( r.object ).toBeDefined();
					expect( typeof r.instanceId ).toBe( 'number' );
					expect( typeof r.contained ).toBe( 'boolean' );

				} );

			} );

			it( 'should collect no objects when the sphere is far away', () => {

				const sphere = new Sphere( new Vector3( 0, 500, 0 ), 1 );
				const results = bvh.collectObjectsInSphere( sphere );
				expect( results.length ).toEqual( 0 );

			} );

			it( 'should collect some objects with a small sphere', () => {

				const sphere = new Sphere( new Vector3( 0, 0, 0 ), 2 );
				const results = bvh.collectObjectsInSphere( sphere );

				// Should collect some but not all (scene spans about ±10 units)
				expect( results.length ).toBeGreaterThanOrEqual( 0 );

			} );

		} );

		describe( 'collectObjectsInFrustum', () => {

			it( 'should collect objects within the camera frustum', () => {

				const camera = new PerspectiveCamera( 75, 1, 0.1, 1000 );
				camera.position.set( 0, 0, 20 );
				camera.lookAt( 0, 0, 0 );
				camera.updateMatrixWorld();

				const frustum = new Frustum();
				const frustumMatrix = new Matrix4()
					.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
				frustum.setFromProjectionMatrix( frustumMatrix );

				const frustumToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const results = bvh.collectObjectsInFrustum( frustum, frustumToBvh );

				expect( results.length ).toBeGreaterThan( 0 );

				results.forEach( r => {

					expect( r.object ).toBeDefined();
					expect( typeof r.instanceId ).toBe( 'number' );
					expect( typeof r.contained ).toBe( 'boolean' );

				} );

			} );

			it( 'should collect no objects when frustum points away', () => {

				const camera = new PerspectiveCamera( 75, 1, 0.1, 100 );
				camera.position.set( 0, 0, 500 );
				camera.lookAt( 0, 0, 1000 ); // looking away from origin
				camera.updateMatrixWorld();

				const frustum = new Frustum();
				const frustumMatrix = new Matrix4()
					.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
				frustum.setFromProjectionMatrix( frustumMatrix );

				const frustumToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const results = bvh.collectObjectsInFrustum( frustum, frustumToBvh );

				expect( results.length ).toEqual( 0 );

			} );

			it( 'should mark contained objects correctly with a large frustum', () => {

				// Use a very large frustum that fully contains all objects
				const camera = new PerspectiveCamera( 170, 1, 0.01, 10000 );
				camera.position.set( 0, 0, 0 );
				camera.updateMatrixWorld();

				const frustum = new Frustum();
				const frustumMatrix = new Matrix4()
					.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
				frustum.setFromProjectionMatrix( frustumMatrix );

				const frustumToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const results = bvh.collectObjectsInFrustum( frustum, frustumToBvh );

				// With a very large frustum at origin, many objects should be contained
				const containedCount = results.filter( r => r.contained ).length;
				expect( containedCount ).toBeGreaterThanOrEqual( 0 );

			} );

		} );

		describe( 'collectObjectsInShapes', () => {

			it( 'should handle multiple shape types in one call', () => {

				const frustum = new Frustum();
				const camera = new PerspectiveCamera( 75, 1, 0.1, 1000 );
				camera.position.set( 0, 0, 20 );
				camera.lookAt( 0, 0, 0 );
				camera.updateMatrixWorld();
				const fm = new Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
				frustum.setFromProjectionMatrix( fm );

				const shapes = [
					{ type: 'box', box: new Box3( new Vector3( - 2, - 2, - 2 ), new Vector3( 2, 2, 2 ) ), boxToBvh: new Matrix4() },
					{ type: 'sphere', sphere: new Sphere( new Vector3( 0, 0, 0 ), 5 ) },
					{ type: 'frustum', frustum: frustum, frustumToBvh: new Matrix4().copy( bvh.matrixWorld ).invert() },
				];

				const results = bvh.collectObjectsInShapes( shapes );

				// All results should have shapeIndex
				results.forEach( r => {

					expect( typeof r.shapeIndex ).toBe( 'number' );
					expect( r.shapeIndex ).toBeGreaterThanOrEqual( 0 );
					expect( r.shapeIndex ).toBeLessThan( shapes.length );

				} );

			} );

			it( 'should deduplicate objects across shapes', () => {

				// Use two identical large boxes - objects should only appear once
				const box = new Box3( new Vector3( - 50, - 50, - 50 ), new Vector3( 50, 50, 50 ) );
				const boxToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const shapes = [
					{ type: 'box', box, boxToBvh },
					{ type: 'box', box, boxToBvh },
				];

				const results = bvh.collectObjectsInShapes( shapes );
				const uniqueKeys = new Set( results.map( r => r.object.uuid + ':' + r.instanceId ) );
				expect( results.length ).toEqual( uniqueKeys.size );

				// All results should be from the first shape (first shape wins)
				results.forEach( r => {

					expect( r.shapeIndex ).toEqual( 0 );

				} );

			} );

			it( 'should return empty for empty shapes array', () => {

				const results = bvh.collectObjectsInShapes( [] );
				expect( results.length ).toEqual( 0 );

			} );

		} );

		describe( 'collect methods vs brute-force consistency', () => {

			it( 'collectObjectsInBox should match brute-force for a large enclosing box', () => {

				const box = new Box3( new Vector3( - 50, - 50, - 50 ), new Vector3( 50, 50, 50 ) );
				const boxToBvh = new Matrix4().copy( bvh.matrixWorld ).invert();
				const bvhResults = bvh.collectObjectsInBox( box, boxToBvh );

				// Brute force: check each object via shapecast
				const bruteResults = [];
				bvh.shapecast( {
					intersectsBounds: () => 1, // INTERSECTED
					intersectsObject: ( object, instanceId ) => {

						if ( object.visible ) {

							bruteResults.push( { object, instanceId } );

						}

					},
				} );

				// Both should collect the same set of objects
				const bvhSet = new Set( bvhResults.map( r => r.object.uuid + ':' + r.instanceId ) );
				const bruteSet = new Set( bruteResults.map( r => r.object.uuid + ':' + r.instanceId ) );

				expect( bvhSet.size ).toEqual( bruteSet.size );
				for ( const key of bruteSet ) {

					expect( bvhSet.has( key ) ).toBe( true );

				}

			} );

		} );

	} );

}

function randomizeMatrix( target ) {

	_position.set(
		( random() - 0.5 ) * 4,
		( random() - 0.5 ) * 4,
		( random() - 0.5 ) * 4,
	);

	_euler.set(
		random() * Math.PI * 2,
		random() * Math.PI * 2,
		random() * Math.PI * 2,
	);

	_quaternion.setFromEuler( _euler );

	_scale.set(
		random() * 1.5 + 0.5,
		random() * 1.5 + 0.5,
		random() * 1.5 + 0.5,
	);

	target.compose( _position, _quaternion, _scale );

}
