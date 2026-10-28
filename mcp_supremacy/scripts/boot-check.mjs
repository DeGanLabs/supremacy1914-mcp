import("./src/http.ts")
  .then(() => {
    console.log("http loaded ok");
    // keep alive briefly then exit — don't listen if already listening from side effects
    setTimeout(() => process.exit(0), 2000);
  })
  .catch((e) => {
    console.error("LOAD_FAIL", e);
    process.exit(1);
  });
