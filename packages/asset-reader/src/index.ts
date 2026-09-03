import { Effect } from "effect"

export interface PakEntry {
  path: string
  size: number
  compression: string
}

export interface PakMetadata {
  version: number
  engine: string
  fileCount: number
}

export type AssetType = "texture" | "mesh" | "blueprint" | "sound" | "material" | "animation" | "data_table" | "localization"

export const AssetReaderService = {
  listFiles: (pakPath: string): Effect.Effect<PakEntry[]> => 
    Effect.succeed([{ path: "Character/Mesh.uasset", size: 1024, compression: "Zlib" }]),
    
  extractFile: (pakPath: string, entry: PakEntry, outPath: string): Effect.Effect<void> => 
    Effect.succeed(undefined),
    
  readMetadata: (pakPath: string): Effect.Effect<PakMetadata> => 
    Effect.succeed({ version: 11, engine: "UE5", fileCount: 1 }),
    
  searchByType: (pakPath: string, type: AssetType): Effect.Effect<PakEntry[]> => 
    Effect.succeed([{ path: "Character/Mesh.uasset", size: 1024, compression: "Zlib" }])
}
