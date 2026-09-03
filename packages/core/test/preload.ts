import path from "path"

process.env.NEXUS_DB = ":memory:"
process.env.NEXUS_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.NEXUS_DISABLE_MODELS_FETCH = "true"
