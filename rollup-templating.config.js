// Template-based code generation has been removed. The cast/ and utils/ modules
// now use runtime branching via `bvh.resolvePrimitiveIndex` to handle both direct
// and indirect BVH modes in a single code path. This eliminates the need for
// build-time template expansion while maintaining equivalent performance.
//
// See: src/core/cast/raycast.js, src/core/utils/iterationUtils.js
export default [];
