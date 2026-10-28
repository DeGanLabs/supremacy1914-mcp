try {
  await import("../src/shots.ts");
  console.log("shots ok");
} catch (e) {
  console.error("shots fail", e);
}
try {
  await import("../src/http.ts");
  console.log("http ok");
} catch (e) {
  console.error("http fail", e);
}
