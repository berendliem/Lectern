import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { KeyTerm } from "@/types";
import type { ExportablePage } from "@/lib/markdown-export";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 20, marginBottom: 16, fontFamily: "Helvetica-Bold" },
  sectionHeading: { fontSize: 14, marginTop: 18, marginBottom: 8, fontFamily: "Helvetica-Bold" },
  subHeading: { fontSize: 12, marginTop: 10, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  paragraph: { marginBottom: 4, lineHeight: 1.4 },
  bullet: { marginBottom: 3, marginLeft: 12, lineHeight: 1.4 },
  card: { marginBottom: 8 },
  cardQuestion: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
});

function MarkdownBlock({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("### ")) {
          return (
            <Text key={i} style={styles.subHeading}>
              {trimmed.slice(4)}
            </Text>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <Text key={i} style={styles.sectionHeading}>
              {trimmed.slice(3)}
            </Text>
          );
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <Text key={i} style={styles.bullet}>
              • {trimmed.slice(2)}
            </Text>
          );
        }
        return (
          <Text key={i} style={styles.paragraph}>
            {trimmed}
          </Text>
        );
      })}
    </>
  );
}

export function PageDocument({ page }: { page: ExportablePage }) {
  const keyTerms: KeyTerm[] = page.notes ? JSON.parse(page.notes.keyTerms) : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{page.title}</Text>

        {page.notes && <MarkdownBlock markdown={page.notes.markdown} />}

        {keyTerms.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Key Terms</Text>
            {keyTerms.map((kt, i) => (
              <Text key={i} style={styles.bullet}>
                • {kt.term}: {kt.definition}
              </Text>
            ))}
          </>
        )}

        {page.flashcards.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Flashcards</Text>
            {page.flashcards.map((card, i) => (
              <View key={i} style={styles.card}>
                <Text style={styles.cardQuestion}>Q: {card.prompt}</Text>
                <Text style={styles.paragraph}>A: {card.idealExplanation}</Text>
              </View>
            ))}
          </>
        )}

        {page.transcript && (
          <>
            <Text style={styles.sectionHeading}>Transcript</Text>
            <Text style={styles.paragraph}>{page.transcript.rawText}</Text>
          </>
        )}
      </Page>
    </Document>
  );
}
