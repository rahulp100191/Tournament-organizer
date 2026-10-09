import { createApp } from "./app.js";
createApp().listen(3001, "127.0.0.1", () =>
  console.log("Rally API: http://127.0.0.1:3001"),
);
