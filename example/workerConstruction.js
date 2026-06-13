/**
 * Worker BVH Construction Example
 *
 * This example demonstrates how to build a MeshBVH in a Web Worker and transfer
 * it back to the main thread using serialize/deserialize. This approach prevents
 * main-thread jank during BVH construction for large geometries.
 *
 * There are two main approaches:
 * 1. Use GenerateMeshBVHWorker (high-level, handles everything)
 * 2. Manual serialize/deserialize (low-level, more control)
 *
 * Both are demonstrated below.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker, ParallelMeshBVHWorker } from 'three-mesh-bvh/worker';

// Apply three.js extensions
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let renderer, scene, camera, controls;
let mesh;
let outputContainer, loadContainer, loadBar, loadText;

// Initialize the scene
init();
animate();

function init() {

	outputContainer = document.getElementById( 'output' );
	loadContainer = document.getElementById( 'loading-container' );
	loadBar = document.querySelector( '#loading-container .bar' );
	loadText = document.querySelector( '#loading-container .text' );

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x263238 );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
	camera.position.set( 0, 0, 5 );

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );

	// Lights
	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 2 ) );

	// Create a complex geometry to demonstrate BVH construction
	const geometry = new THREE.TorusKnotGeometry( 1, 0.3, 500, 100 );
	const material = new THREE.MeshStandardMaterial( {
		color: 0x4db6ac,
		roughness: 0.75,
		metalness: 0.1
	} );
	mesh = new THREE.Mesh( geometry, material );
	scene.add( mesh );

	// Build BVH using the preferred method
	// Choose one of the following approaches:

	// Method 1: High-level API with GenerateMeshBVHWorker (recommended)
	buildBVHWithGenerateWorker( mesh.geometry );

	// Method 2: Use ParallelMeshBVHWorker for faster construction on multi-core systems
	// Requires SharedArrayBuffer support (cross-origin isolation headers)
	// buildBVHWithParallelWorker( mesh.geometry );

	// Method 3: Manual serialize/deserialize for custom worker setups
	// buildBVHManually( mesh.geometry );

	window.addEventListener( 'resize', onWindowResize );

}

/**
 * Method 1: GenerateMeshBVHWorker (High-level API)
 *
 * This is the simplest approach. The worker handles geometry transfer,
 * BVH construction, and result transfer automatically.
 */
function buildBVHWithGenerateWorker( geometry ) {

	const worker = new GenerateMeshBVHWorker();
	const startTime = performance.now();

	// Progress callback receives a value in [0, 1]
	const onProgress = ( progress ) => {

		const percent = Math.round( progress * 100 );
		loadContainer.style.visibility = 'visible';
		loadBar.style.width = `${ percent }%`;
		loadText.innerText = `Building BVH: ${ percent }%`;

	};

	worker.generate( geometry, {
		strategy: 0, // CENTER
		maxDepth: 40,
		maxLeafSize: 10,
		indirect: false,
		onProgress
	} ).then( bvh => {

		// Assign the BVH to the geometry
		geometry.boundsTree = bvh;

		// Clean up the worker when done
		worker.dispose();

		loadContainer.style.visibility = 'hidden';

		const elapsed = performance.now() - startTime;
		outputContainer.textContent =
			`Method: GenerateMeshBVHWorker\n` +
			`BVH Construction Time: ${ elapsed.toFixed( 2 ) }ms\n` +
			`Triangles: ${ geometry.index.count / 3 }\n` +
			`Indirect Mode: ${ bvh.indirect }\n` +
			`\nClick to test raycasting`;

		// Test raycasting
		testRaycast();

	} ).catch( err => {

		console.error( 'BVH generation failed:', err );
		worker.dispose();

	} );

}

/**
 * Method 2: ParallelMeshBVHWorker (Multi-threaded)
 *
 * Uses multiple workers for faster BVH construction.
 * Requires SharedArrayBuffer and cross-origin isolation.
 */
function buildBVHWithParallelWorker( geometry ) {

	// Check for SharedArrayBuffer support
	if ( typeof SharedArrayBuffer === 'undefined' ) {

		console.warn( 'SharedArrayBuffer not available. Use GenerateMeshBVHWorker instead.' );
		buildBVHWithGenerateWorker( geometry );
		return;

	}

	const worker = new ParallelMeshBVHWorker();
	worker.maxWorkerCount = navigator.hardwareConcurrency || 4;

	const startTime = performance.now();

	const onProgress = ( progress ) => {

		const percent = Math.round( progress * 100 );
		loadContainer.style.visibility = 'visible';
		loadBar.style.width = `${ percent }%`;
		loadText.innerText = `Building BVH (parallel): ${ percent }%`;

	};

	worker.generate( geometry, {
		strategy: 0,
		maxDepth: 40,
		maxLeafSize: 10,
		indirect: false,
		onProgress
	} ).then( bvh => {

		geometry.boundsTree = bvh;
		worker.dispose();

		loadContainer.style.visibility = 'hidden';

		const elapsed = performance.now() - startTime;
		outputContainer.textContent =
			`Method: ParallelMeshBVHWorker\n` +
			`Worker Count: ${ worker.maxWorkerCount }\n` +
			`BVH Construction Time: ${ elapsed.toFixed( 2 ) }ms\n` +
			`Triangles: ${ geometry.index.count / 3 }`;

		testRaycast();

	} );

}

/**
 * Method 3: Manual serialize/deserialize (Low-level API)
 *
 * This gives you full control over the worker communication.
 * Useful when you need custom worker logic or want to use a worker pool.
 */
async function buildBVHManually( geometry ) {

	const startTime = performance.now();

	// Create a custom worker
	const workerCode = `
		import { MeshBVH } from 'three-mesh-bvh';
		import { BufferGeometry, BufferAttribute } from 'three';

		self.onmessage = function( event ) {
			const { index, position, options } = event.data;

			try {
				// Reconstruct geometry in worker
				const geometry = new BufferGeometry();
				geometry.setAttribute( 'position', new BufferAttribute( position, 3 ) );
				if ( index ) {
					geometry.setIndex( new BufferAttribute( index, 1 ) );
				}

				// Build BVH
				const bvh = new MeshBVH( geometry, options );

				// Serialize for transfer
				const serialized = MeshBVH.serialize( bvh, { cloneBuffers: false } );

				// Transfer buffers back
				const transferList = [ position.buffer, ...serialized.roots ];
				if ( serialized.index ) transferList.push( serialized.index.buffer );
				if ( serialized.indirectBuffer ) transferList.push( serialized.indirectBuffer.buffer );

				self.postMessage(
					{ success: true, serialized, position },
					transferList
				);

			} catch ( error ) {
				self.postMessage( { success: false, error: error.message } );
			}
		};
	`;

	const blob = new Blob( [ workerCode ], { type: 'application/javascript' } );
	const workerUrl = URL.createObjectURL( blob );
	const worker = new Worker( workerUrl, { type: 'module' } );

	// Extract geometry data
	const position = geometry.attributes.position.array;
	const index = geometry.index ? geometry.index.array : null;

	// Set up transfer list
	const transferList = [ position.buffer ];
	if ( index ) transferList.push( index.buffer );

	// Promise wrapper for worker communication
	const result = await new Promise( ( resolve, reject ) => {

		worker.onmessage = ( event ) => {

			if ( event.data.success ) {

				resolve( event.data );

			} else {

				reject( new Error( event.data.error ) );

			}

			worker.terminate();

		};

		worker.onerror = ( error ) => reject( error );

		// Send geometry data to worker
		worker.postMessage( {
			position,
			index,
			options: {
				strategy: 0,
				maxDepth: 40,
				maxLeafSize: 10,
				indirect: false
			}
		}, transferList );

	} );

	// Deserialize the BVH on the main thread
	const bvh = MeshBVH.deserialize( result.serialized, geometry, { setIndex: false } );

	// Restore position buffer (it was transferred)
	geometry.attributes.position.array = result.position;

	// Assign to geometry
	geometry.boundsTree = bvh;

	URL.revokeObjectURL( workerUrl );

	const elapsed = performance.now() - startTime;
	outputContainer.textContent =
		`Method: Manual serialize/deserialize\n` +
		`BVH Construction Time: ${ elapsed.toFixed( 2 ) }ms\n` +
		`Triangles: ${ geometry.index.count / 3 }`;

	testRaycast();

}

/**
 * Demonstrates using the BVH for raycasting with detailed progress callbacks.
 */
function testRaycast() {

	const raycaster = new THREE.Raycaster();
	raycaster.set( new THREE.Vector3( 0, 0, 5 ), new THREE.Vector3( 0, 0, - 1 ) );

	const intersects = raycaster.intersectObject( mesh );

	outputContainer.textContent += `\nRaycast hits: ${ intersects.length }`;

	if ( intersects.length > 0 ) {

		outputContainer.textContent += `\nFirst hit distance: ${ intersects[ 0 ].distance.toFixed( 3 ) }`;

	}

}

/**
 * Example: Using onDetailedProgress for fine-grained build info
 */
function buildBVHWithDetailedProgress( geometry ) {

	// Note: onDetailedProgress is only available when building on the main thread
	// For worker builds, use onProgress instead

	const bvh = new MeshBVH( geometry, {
		strategy: 0,
		maxLeafSize: 10,
		onProgress: ( progress ) => {

			console.log( `Progress: ${( progress * 100 ).toFixed( 1 )}%` );

		},
		onDetailedProgress: ( info ) => {

			// info contains:
			// - progress: 0-1 value
			// - nodeIndex: current node being processed
			// - depth: current tree depth
			// - isLeaf: whether this is a leaf node
			// - primitiveCount: primitives in this node
			// - processedPrimitives: total primitives processed so far
			// - totalPrimitives: total primitives to process
			// - nodeCount: total nodes created so far

			console.log(
				`Node ${ info.nodeIndex } at depth ${ info.depth }: ` +
				`${ info.isLeaf ? 'leaf' : 'internal' }, ` +
				`${ info.primitiveCount } primitives, ` +
				`${ info.processedPrimitives }/${ info.totalPrimitives } total`
			);

		}
	} );

	geometry.boundsTree = bvh;
	return bvh;

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

}

function animate() {

	requestAnimationFrame( animate );
	controls.update();
	renderer.render( scene, camera );

}
