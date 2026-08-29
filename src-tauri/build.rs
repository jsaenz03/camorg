fn main() {
  // The dev binary embeds Info.plist inside the generate_context! proc
  // macro (tauri-codegen merges it via embed_plist), but cargo doesn't know
  // the macro reads this file — without this line a plist edit never
  // triggers a recompile, so camera permission keys stay stale.
  println!("cargo:rerun-if-changed=Info.plist");
  tauri_build::build()
}
