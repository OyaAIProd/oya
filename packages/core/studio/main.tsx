import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./studio.css";
import { Studio } from "./Studio";

createRoot(document.getElementById("root")!).render(<Studio />);
