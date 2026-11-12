import { render } from "preact";
import { App } from "./app";
import { lang } from "./i18n";
import "@fontsource/silkscreen/latin-400.css";
import "@fontsource/silkscreen/latin-700.css";
import "@fontsource/schibsted-grotesk/latin-500.css";
import "@fontsource/schibsted-grotesk/latin-700.css";
import "@fontsource/schibsted-grotesk/latin-800.css";
import "./style.css";

document.documentElement.lang = lang();
render(<App />, document.getElementById("app")!);
