import { MeshBVH, BVHOptions } from '../index.js';
import { BufferGeometry } from 'three';

export interface WorkerBVHOptions extends BVHOptions {
	onProgress?: ( progress: number ) => void;
}

export class GenerateMeshBVHWorker {

	readonly running: boolean;
	readonly name: string;

	constructor();

	generate( geometry: BufferGeometry, options?: WorkerBVHOptions ): Promise<MeshBVH>;
	dispose(): void;

}

export class ParallelMeshBVHWorker extends GenerateMeshBVHWorker {

	maxWorkerCount: number;

	constructor();

}
