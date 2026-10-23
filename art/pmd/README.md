# PMD-style library sources

`registry.json` contains selected sources and candidates held for correction. Only records with `reviewed:true` are used by the library builder. Each record names its exact species/form, source file, provenance and any tile-order, mirror or excluded-phase correction. Acceptance requires anatomy and the complete locomotion loop at actual runtime size: limbs must exchange supports where appropriate, body volume and attachments must stay coherent, and legless/flying forms must use suitable movement. Transparent gutters, different hashes or sixteen cutouts alone do not establish animation quality. Actual used directions/poses are emitted in the installed manifest.

Generated fan-art sources, user-supplied originals and published walking sprites remain distinct. Existing suitable artwork takes priority over regeneration. Published art is collected from the pinned upstream revision at build time and keeps its attribution. See [artwork and movement references](SOURCES.md). `palette-sources.json` records normal/shiny reference pairs used for explicit recolours. Source hashes and palette provenance are retained by the builder.

The application and exported pages use the installed image packs; neither needs an image model or access to these authoring services. See [the library architecture](../../docs/PMD_LIBRARY.md).
