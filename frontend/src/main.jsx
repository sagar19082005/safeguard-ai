import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./index.css";
import App from "./App";

if (localStorage.getItem("sg_theme") === "dark") document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
