import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
export function PrivatePhoto({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    (async () => {
      if (!/^\/api\/v1\/me\/uploads\/[a-f0-9-]{36}$/.test(path)) return;
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) return;
      const response = await fetch(path, {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) {
        objectUrl = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) URL.revokeObjectURL(objectUrl);
        else setUrl(objectUrl);
      }
    })().catch(() => {});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url ? (
    <img
      src={url}
      alt={name + " private profile photo"}
      style={{
        width: 80,
        height: 80,
        objectFit: "cover",
        borderRadius: "50%",
        margin: "16px 0",
      }}
    />
  ) : null;
}
