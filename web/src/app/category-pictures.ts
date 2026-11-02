const files: Record<string, string> = {
  'Τρόφιμα': 'cat-trofima.jpg',
  'Ποτά': 'cat-pota.jpg',
  'Προσωπική Φροντίδα': 'cat-frontida.jpg',
  'Καθαριότητα': 'cat-kathariotita.jpg',
  'Βρεφικά': 'cat-vrefika.jpg',
  'Είδη για Κατοικίδια': 'cat-pets.jpg',
  'Τρόφιμα > Άλλα Γαλακτοκομικά/Βούτυρα/Αυγά': 'cat-galaktokomika.jpg',
  'Τρόφιμα > Έτοιμα Γεύματα': 'cat-geyma.jpg',
  'Τρόφιμα > Αρτοποιείο / Πρωινό': 'cat-artopoieio.jpg',
  'Τρόφιμα > Γάλα': 'cat-gala.jpg',
  'Τρόφιμα > Κατεψυγμένα Τρόφιμα': 'cat-katepsygmena.jpg',
  'Τρόφιμα > Κονσέρβες / Πουρές': 'cat-konserves.jpg',
  'Τρόφιμα > Μαγειρική & Βασικά Υλικά': 'cat-mageiriki.jpg',
  'Τρόφιμα > Πουλερικά, Αλλαντικά': 'cat-allantika.jpg',
  'Τρόφιμα > Ρύζι, Ζυμαρικά, Όσπρια': 'cat-zymarika.jpg',
  'Τρόφιμα > Σνακ': 'cat-snak.jpg',
  'Τρόφιμα > Σοκολάτες/Μπισκότα/Σοκολατοειδή': 'cat-sokolata.jpg',
  'Τρόφιμα > Συσκευασμένα Λαχανικά': 'cat-lachanika.jpg',
  'Τρόφιμα > Τυριά': 'cat-tyria.jpg',
  'Ποτά > Αλκοολούχα Ποτά': 'cat-alcohol.jpg',
  'Ποτά > Αναψυκτικά': 'cat-anapsyktika.jpg',
  'Ποτά > Εμφιαλωμένο Νερό': 'cat-nero.jpg',
  'Ποτά > Ενεργειακά / Ισοτονικά / \'Ετοιμα κοκτέιλ': 'cat-energy.jpg',
  'Ποτά > Καφές': 'cat-kafes.jpg',
  'Ποτά > Τσάι/Σοκολάτα-Κακάο/Αφεψίματα': 'cat-tsai.jpg',
  'Ποτά > Χυμοί': 'cat-chymoi.jpg',
  'Καθαριότητα > Εντομοκτόνα, Εντομοαπωθητικά': 'cat-entoma.jpg',
  'Καθαριότητα > Κουζίνα': 'cat-kouzina.jpg',
  'Καθαριότητα > Μπάνιο': 'cat-mpanio.jpg',
  'Καθαριότητα > Ρούχα': 'cat-roucha.jpg',
  'Καθαριότητα > Χαρτικά': 'cat-chartika.jpg',
  'Προσωπική Φροντίδα > Γυναικεία φροντίδα': 'cat-gynaikeia.jpg',
  'Προσωπική Φροντίδα > Μαλλιά': 'cat-mallia.jpg',
  'Προσωπική Φροντίδα > Ξύρισμα & Ανδρική φροντίδα': 'cat-xyrisma.jpg',
  'Προσωπική Φροντίδα > Προφυλακτικά': 'cat-pharmacy.jpg',
  'Προσωπική Φροντίδα > Στοματική Υγιεινή': 'cat-stoma.jpg',
  'Προσωπική Φροντίδα > Σώμα': 'cat-soma.jpg',
  'Βρεφικά > Βρεφικές τροφές': 'cat-vrefikes-trofes.jpg',
  'Βρεφικά > Βρεφική φροντίδα': 'cat-vrefiki-frontida.jpg',
  'Βρεφικά > Μωρομάντηλα': 'cat-mantila.jpg',
  'Βρεφικά > Παιδικές Πάνες': 'cat-panes.jpg',
  'Είδη για Κατοικίδια > Γάτα': 'cat-gata.jpg',
  'Είδη για Κατοικίδια > Σκύλος': 'cat-skylos.jpg',
};

function clean(value: string): string {
  return value.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

export function categoryPicture(parentPath: string, name: string): string {
  const full = clean(parentPath ? `${parentPath} > ${name}` : name);
  const parts = full.split(' > ').filter(Boolean);
  while (parts.length) {
    const file = files[parts.join(' > ')];
    if (file) {
      return `/categories/${file}`;
    }
    parts.pop();
  }
  return '/categories/cat-trofima.jpg';
}
