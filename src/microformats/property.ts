import { serialize } from "parse5";

import { getAttributeIfTag, getClassNames } from "../helpers/attributes";
import {
  ParsedProperty,
  ParentNode,
  MicroformatProperty,
  Html,
  PropertyType,
  ParsingOptions,
} from "../types";
import { isMicroformatRoot } from "../helpers/nodeMatchers";
import { parseMicroformat } from "./parse";
import { valueClassPattern } from "../helpers/valueClassPattern";
import { textContent } from "../helpers/textContent";
import { parseImage } from "../helpers/images";
import { isLocalLink, applyBaseUrl } from "../helpers/url";
import { convertV1PropertyClassNames } from "../backcompat";

const propertyRegexp = /^(p|u|e|dt)-/;

const getType = (className: string): PropertyType =>
  (className.startsWith("p-") && "p") ||
  (className.startsWith("u-") && "u") ||
  (className.startsWith("e-") && "e") ||
  "dt";

export const parseP = (node: ParentNode): string =>
  valueClassPattern(node) ??
  getAttributeIfTag(node, ["abbr", "link"], "title") ??
  getAttributeIfTag(node, ["data"], "value") ??
  getAttributeIfTag(node, ["img", "area"], "alt") ??
  textContent(node);

export const parseU = (
  node: ParentNode,
  options: ParsingOptions
): MicroformatProperty => {
  const url =
    getAttributeIfTag(node, ["a", "area", "link"], "href") ??
    parseImage(node, options) ??
    getAttributeIfTag(node, ["audio", "source", "iframe", "video"], "src") ??
    getAttributeIfTag(node, ["video"], "poster") ??
    getAttributeIfTag(node, ["object"], "data") ??
    valueClassPattern(node) ??
    getAttributeIfTag(node, ["abbr"], "title") ??
    getAttributeIfTag(node, ["data", "input"], "value") ??
    textContent(node);

  return typeof url === "string" && isLocalLink(url)
    ? applyBaseUrl(url, options.baseUrl)
    : url;
};

const parseDt = (node: ParentNode): string =>
  valueClassPattern(node, { datetime: true }) ??
  getAttributeIfTag(node, ["time", "ins", "del"], "datetime") ??
  getAttributeIfTag(node, ["abbr"], "title") ??
  getAttributeIfTag(node, ["data", "input"], "value") ??
  textContent(node);

export const parseE = (node: ParentNode): Html => ({
  value: textContent(node),
  html: serialize(node).trim(),
});

const getPropertyClassNames = (
  node: ParentNode,
  { roots }: ParsingOptions
): string[] => {
  if (roots.length) {
    return convertV1PropertyClassNames(node, roots);
  }

  return getClassNames(node, /^(p|u|e|dt)-/);
};

const handleProperty = (
  node: ParentNode,
  type: PropertyType,
  options: ParsingOptions
): MicroformatProperty => {
  if (type === "p") {
    return parseP(node);
  }

  if (type === "e") {
    return parseE(node);
  }

  if (type === "u") {
    return parseU(node, options);
  }

  return parseDt(node);
};

export const parseProperty = (
  child: ParentNode,
  options: ParsingOptions
): ParsedProperty[] =>
  getPropertyClassNames(child, options)
    .map((className): ParsedProperty | undefined => {
      const type = getType(className);
      const key = className.replace(propertyRegexp, "");
      const value =
        ["u", "p", "e"].includes(type) && isMicroformatRoot(child)
          ? parseMicroformat(child, {
              ...options,
              valueType: type,
              valueKey: key,
            })
          : handleProperty(child, type, options);

      return { type, key, value };
    })
    .filter((p): p is ParsedProperty => Boolean(p));

/**
 * Some properties require knowledge of other properties to be parsed correctly
 * Apply known post-initial-parse rules here:
 *  - dt-end should be dt-start aware
 */
export const postParseNode = (
  prop: ParsedProperty,
  _i: number,
  all: ParsedProperty[]
): ParsedProperty => {
  // Imply an end date if only time specified
  if (
    prop.type === "dt" &&
    prop.key === "end" &&
    typeof prop.value === "string" &&
    !prop.value.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/) &&
    prop.value.match(/^[0-9]{2}:[0-9]{2}/)
  ) {
    const value = all.find(
      (p) =>
        p.type === "dt" && p.key === "start" && typeof prop.value === "string"
    )?.value as string;

    if (value) {
      const date = value.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/);

      return { ...prop, value: `${date} ${prop.value}` };
    }
  }

  return prop;
};