/**
 * Worker BVH Build Example
 *
 * Demonstrates how to build a MeshBVH in a Web Worker and transfer it back to the
 * main thread using serialize/deserialize. Also shows the detailed `onBuildProgress`
 * callback that provides node-level build information.
 *
 * Key concepts:
 * 1. Geometry buffers are transferred to the worker (zero-copy when possible)
 * 2. BVH is built asynchronously without blocking the main thread
 * 3. Serialized BVH data is transferred back and deserialized on the main thread
 * 4. `onBuildProgress` provides detailed node-level information during construction
 */
import * as THREE from 'three';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { MeshBVH, BVHHelper, CENTER, SAH, AVERAGE } from 'three-mesh-bvh';

// UI elements
const statusEl = document.getElementById( 'status' );
const progressPctEl = document.getElementById( 'progress-pct' );
const progressFillEl = document.getElementById( 'progress-fill' );
const progressDepthEl = document.getElementById( 'progress-depth' );
const progressNodeEl = document.getElementById( 'progress-node' );
const progressRemainingEl = document.getElementById( 'progress-remaining' );
const outputEl = document.getElementById( 'output' );

// Scene setup
const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setClearColor( 0x263238 );
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.1, 100 );
camera.position.set( 0, 2, 5 );
camera.lookAt( 0, 0, 0 );

const light = new THREE.DirectionalLight( 0xffffff, 3 );
light.position.set( 5, 10, 7 );
scene.add( light );
scene.add( new THREE.AmbientLight( 0xb0bec5, 1.5 ) );

// Create a large geometry to demonstrate the worker build
// Using a high-resolution torus knot to ensure meaningful build times
const geometry = new THREE.TorusKnotGeometry( 1, 0.4, 500, 200, 3, 5 );
const material = new THREE.MeshStandardMaterial( {
	color: 0x4db6ac,
	roughness: 0.6,
	metalness: 0.3,
} );
const mesh = new THREE.Mesh( geometry, material );
scene.add( mesh );

// Create the worker
// `GenerateMeshBVHWorker` handles all the serialization/deserialization internally.
// Behind the scenes:
//   1. Position and index ArrayBuffers are transferred to the worker
//   2. BVH is built in the worker thread
//   3. The resulting BVH is serialized and transferred back
//   4. `MeshBVH.deserialize` reconstructs the BVH on the main thread
const worker = new GenerateMeshBVHWorker();

let helper = null;

// Start the BVH build in the worker
statusEl.textContent = 'building...';

const startTime = performance.now();

/**
 * Example 1: Using GenerateMeshBVHWorker (simplest approach)
 *
 * The worker handles serialize/deserialize internally. Use `onProgress` for a simple
 * 0-1 progress value, and `onBuildProgress` for detailed node-level information.
 */
worker.generate( geometry, {
	strategy: SAH,
	maxLeafSize: 10,
	indirect: false,

	// Simple progress callback - just a number from 0 to 1
	onProgress( progress ) {

		const pct = ( progress * 100 ).toFixed( 1 );
		progressPctEl.textContent = `${ pct }%`;
		progressFillEl.style.width = `${ pct }%`;

	},

	// Detailed progress callback - provides rich build information
	onBuildProgress( info ) {

		// info contains:
		//   progress:          Overall progress in [0, 1]
		//   currentDepth:      Current tree depth being processed
		//   nodeIndex:         Sequential node index
		//   isLeaf:            Whether the current node is a leaf
		//   primitiveOffset:   Primitive offset of the current node
		//   primitiveCount:    Number of primitives in the current node
		//   primitivesProcessed: Total primitives processed so far
		//   totalPrimitives:   Total number of primitives
		//   remainingPrimitives: Remaining primitives to process
		//   totalNodes:        Total nodes created so far

		const pct = ( info.progress * 100 ).toFixed( 1 );
		progressPctEl.textContent = `${ pct }%`;
		progressFillEl.style.width = `${ pct }%`;
		progressDepthEl.textContent = info.currentDepth;
		progressNodeEl.textContent = info.nodeIndex;
		progressRemainingEl.textContent =
			`${ info.remainingPrimitives } / ${ info.totalPrimitives }`;

	},

} ).then( bvh => {

	const elapsed = performance.now() - startTime;

	// The BVH is ready! Attach it to the geometry.
	geometry.boundsTree = bvh;

	statusEl.textContent = 'done';
	progressPctEl.textContent = '100%';
	progressFillEl.style.width = '100%';

	// Display BVH helper
	helper = new BVHHelper( mesh, 5 );
	helper.update();
	scene.add( helper );

	outputEl.textContent = [
		`Build time      : ${ elapsed.toFixed( 1 ) }ms`,
		`Triangles       : ${ geometry.index.count / 3 }`,
		`Strategy        : SAH`,
		`Indirect        : false`,
		`Worker          : GenerateMeshBVHWorker`,
	].join( '\n' );

} );

/**
 * Example 2: Manual serialize/deserialize (for advanced use cases)
 *
 * This approach gives more control over buffer transfer and is useful when
 * you need to share BVH data across multiple workers using SharedArrayBuffer.
 *
 * ```js
 * // In the worker:
 * const bvh = new MeshBVH( geometry, options );
 * const serialized = MeshBVH.serialize( bvh );
 * // Transfer `serialized.roots`, `serialized.index`, and position buffer back
 * self.postMessage( { serialized, position }, transferList );
 *
 * // In the main thread:
 * const bvh = MeshBVH.deserialize( serialized, geometry );
 * geometry.boundsTree = bvh;
 * ```
 */

// Render loop
function render() {

	const t = performance.now() * 0.001;
	mesh.rotation.y = t * 0.3;

	if ( helper ) {

		helper.visible = true;

	}

	renderer.render( scene, camera );
	requestAnimationFrame( render );

}

render();

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );
