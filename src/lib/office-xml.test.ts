import { test } from "node:test";
import assert from "node:assert/strict";
import { slideXmlToText, docxXmlToText, sortSlideEntries } from "./office-xml.ts";

test("slideXmlToText joins the text runs on a slide", () => {
  const xml =
    '<p:sld><a:t>Enzyme kinetics</a:t><a:t>Michaelis</a:t><a:t>Menten</a:t></p:sld>';
  assert.equal(slideXmlToText(xml), "Enzyme kinetics Michaelis Menten");
});

test("slideXmlToText decodes entities and ignores empty runs", () => {
  const xml = '<p:sld><a:t>Rate &amp; yield</a:t><a:t></a:t><a:t>k &lt; 1</a:t></p:sld>';
  assert.equal(slideXmlToText(xml), "Rate & yield k < 1");
});

test("docxXmlToText puts a newline at each paragraph break", () => {
  const xml =
    "<w:body><w:p><w:r><w:t>Dr Vos   0:09</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Yes.</w:t></w:r><w:r><w:t> Let us start.</w:t></w:r></w:p></w:body>";
  assert.equal(docxXmlToText(xml), "Dr Vos   0:09\nYes. Let us start.");
});

test("docxXmlToText keeps significant whitespace in xml:space runs", () => {
  const xml = '<w:p><w:r><w:t xml:space="preserve">Berend   </w:t></w:r><w:r><w:t>0:03</w:t></w:r></w:p>';
  assert.equal(docxXmlToText(xml), "Berend   0:03");
});

test("slideXmlToText survives an out-of-range numeric entity", () => {
  const xml = "<p:sld><a:t>Rate &#999999999; yield</a:t><a:t>&#65; ok</a:t></p:sld>";
  const out = slideXmlToText(xml);
  assert.ok(out.includes("Rate"), "text around a bad entity must survive");
  assert.ok(out.includes("yield"));
  assert.ok(out.includes("A ok"), "valid numeric entities must still decode");
});

test("sortSlideEntries orders numerically, not lexically", () => {
  const sorted = sortSlideEntries([
    "ppt/slides/slide10.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide1.xml",
    "ppt/slides/_rels/slide1.xml.rels",
    "docProps/core.xml",
  ]);
  assert.deepEqual(sorted, [
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide10.xml",
  ]);
});
