// Code highlighting for chat answers and notes: rehype-highlight's plugin (MIT, wooorm), trimmed to the languages a
// student's PDFs and questions actually use. rehype-highlight always bundles lowlight's 37 "common" grammars (about
// 55 KB gzipped on the chat screen); these 21 come to about 37 KB. A fence in any other language shows as plain code.
import type { Element, ElementContent, Root } from "hast";
import { toText } from "hast-util-to-text";
import { createLowlight } from "lowlight";
import { visit } from "unist-util-visit";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

export const LANGUAGES = {
  bash, c, cpp, csharp, css, go, java, javascript, json, kotlin, markdown, php, plaintext, python, r, rust, shell, sql,
  typescript, xml, yaml,
};

const lowlight = createLowlight(LANGUAGES);

/** The language a <code> names (language-x / lang-x), false for no-highlight, undefined for none. */
function language(node: Element): string | false | undefined {
  const list = node.properties.className;
  if (!Array.isArray(list)) return undefined;
  let name: string | undefined;
  for (const item of list) {
    const value = String(item);
    if (value === "no-highlight" || value === "nohighlight") return false;
    if (!name && value.startsWith("lang-")) name = value.slice(5);
    if (!name && value.startsWith("language-")) name = value.slice(9);
  }
  return name;
}

/** A rehype plugin: colours ```lang fences (no guessing for unlabelled code, like rehype-highlight's default). */
export default function rehypeHighlightSome() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, _i, parent) => {
      if (node.tagName !== "code" || !parent || parent.type !== "element" || (parent as Element).tagName !== "pre") return;
      const lang = language(node);
      if (!lang) return;
      if (!Array.isArray(node.properties.className)) node.properties.className = [];
      const classes = node.properties.className as (string | number)[];
      if (!classes.includes("hljs")) classes.unshift("hljs");     // the code-block look, whatever the language
      if (!lowlight.registered(lang)) return;                       // not carried: plain text in that look
      const result = lowlight.highlight(lang, toText(node, { whitespace: "pre" }));
      if (result.children.length > 0) node.children = result.children as ElementContent[];
    });
  };
}
