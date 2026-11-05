import { Injectable, Pipe, PipeTransform, signal } from '@angular/core';

type LanguageCode = 'el' | 'en';

const messages = {
  el: {
    'nav.home': 'Αρχική',
    'nav.catalog': 'Κατάλογος',
    'nav.lists': 'Λίστες',
    'nav.history': 'Ιστορικό',
    'nav.notices': 'Ειδοποιήσεις',
    'nav.close': 'Κλείσιμο μενού',
    'nav.menu': 'Μενού',
    'nav.shoppingList': 'Λίστα αγορών',
    'nav.where': 'Τοποθεσία',
    'lang.switch': 'Αλλαγή γλώσσας',
    'brand.tagline': 'Συγκρίνετε τιμές και οργανώστε τα κοινά σας ψώνια.',
    'action.logout': 'Αποσύνδεση',
    'action.create': 'Δημιουργία',
    'action.join': 'Συμμετοχή',
    'action.open': 'Άνοιγμα',
    'action.search': 'Αναζήτηση',
    'action.apply': 'Εφαρμογή',
    'action.add': 'Προσθήκη',
    'action.addProduct': 'Προσθήκη προϊόντος',
    'action.chooseOffer': 'Επιλογή τιμής',
    'action.confirm': 'Επιβεβαίωση',
    'action.cancel': 'Ακύρωση',
    'action.remove': 'Αφαίρεση',
    'action.delete': 'Διαγραφή',
    'action.copy': 'Αντιγραφή',
    'action.previous': 'Προηγούμενα',
    'action.next': 'Επόμενα',
    'action.saveList': 'Αποθήκευση λίστας',
    'action.createList': 'Νέα λίστα',
    'action.showAll': 'Προβολή όλων',
    'common.products': '{count} προϊόντα',
    'common.product': '{count} προϊόν',
    'common.people': '{count} άτομα',
    'common.peopleOne': '{count} άτομο',
    'common.someone': 'κάποιο μέλος',
    'common.offers': '{count} καταστήματα',
    'common.owner': 'Ιδιοκτήτης',
    'common.editor': 'Μέλος',
    'common.open': 'Ανοιχτή',
    'common.saved': 'Αποθηκευμένη',
    'common.loading': 'Φόρτωση…',
    'common.total': 'Σύνολο',
    'common.updated': 'Ενημερώθηκε',
    'home.title': 'Οι λίστες μου',
    'home.lead': 'Οι κοινόχρηστες λίστες και τα ψώνια σας, σε ένα μέρος.',
    'home.openLists': 'Ανοιχτές λίστες',
    'home.savedLists': 'Αποθηκευμένες λίστες',
    'home.openLead': 'Συνεχίστε από την πιο πρόσφατη λίστα.',
    'home.savedLead': 'Οι τιμές παραμένουν όπως ήταν όταν αποθηκεύτηκαν.',
    'home.noOpen': 'Δεν υπάρχουν ανοιχτές λίστες.',
    'home.noSaved': 'Δεν υπάρχουν αποθηκευμένες λίστες.',
    'home.noItems': 'Δεν έχουν προστεθεί προϊόντα.',
    'home.browse': 'Περιήγηση στον κατάλογο',
    'home.loading': 'Φόρτωση λιστών…',
    'home.error': 'Δεν ήταν δυνατή η φόρτωση των λιστών.',
    'lists.title': 'Λίστες',
    'lists.lead': 'Δημιουργήστε λίστα ή συμμετάσχετε με κωδικό πρόσκλησης.',
    'lists.newTitle': 'Νέα λίστα',
    'lists.titleLabel': 'Όνομα λίστας',
    'lists.titlePlaceholder': 'π.χ. Εβδομαδιαία ψώνια',
    'lists.inviteLabel': 'Κωδικός πρόσκλησης',
    'lists.joinLead': 'Έχετε κωδικό; Συμμετάσχετε σε μια ανοιχτή λίστα.',
    'lists.noLists': 'Δεν υπάρχουν ανοιχτές λίστες. Δημιουργήστε μία ή συμμετάσχετε με κωδικό.',
    'lists.loading': 'Φόρτωση λιστών…',
    'lists.error': 'Δεν ήταν δυνατή η φόρτωση των λιστών.',
    'lists.created': 'Η λίστα δημιουργήθηκε.',
    'lists.joined': 'Συμμετέχετε στη λίστα.',
    'lists.copySuccess': 'Ο κωδικός αντιγράφηκε.',
    'list.back': 'Πίσω στις λίστες',
    'list.openLead': 'Τα μέλη μπορούν να προσθέτουν, να αλλάζουν ή να αφαιρούν προϊόντα όσο η λίστα είναι ανοιχτή.',
    'list.savedLead': 'Οι τιμές και η ημερομηνία αποθήκευσης παραμένουν σταθερές.',
    'list.members': 'Μέλη',
    'list.inviteCode': 'Κωδικός πρόσκλησης',
    'list.copyCode': 'Αντιγραφή κωδικού',
    'list.removeMember': 'Αφαίρεση μέλους',
    'list.removeMemberConfirm': 'Να αφαιρεθεί ο/η {member} από τη λίστα «{list}»;',
    'list.memberRemoved': 'Το μέλος αφαιρέθηκε.',
    'list.addProduct': 'Προσθήκη προϊόντος',
    'list.searchPlaceholder': 'Όνομα προϊόντος ή συσκευασία',
    'list.searchHint': 'Αναζητήστε προϊόν και συγκρίνετε τιμές καταστημάτων πριν από την προσθήκη.',
    'list.noResults': 'Δεν βρέθηκαν προϊόντα στον κατάλογο.',
    'list.results': 'Αποτελέσματα',
    'list.onList': 'Στη λίστα',
    'list.empty': 'Δεν υπάρχουν προϊόντα ακόμη. Αναζητήστε ένα προϊόν για να ξεκινήσετε.',
    'list.saveLead': 'Η αποθήκευση κρατά τις τρέχουσες τιμές και κλειδώνει τη λίστα.',
    'list.savedNotice': 'Η λίστα αποθηκεύτηκε με τις τρέχουσες τιμές.',
    'list.added': 'Προστέθηκε το {product}.',
    'list.quantity': 'Ποσότητα',
    'list.quantityWhole': 'Η ποσότητα πρέπει να είναι ακέραιος αριθμός από 1 έως 9999.',
    'list.priceByStore': 'Τιμή ανά κατάστημα',
    'list.chooseStore': 'Επιλέξτε κατάστημα',
    'list.packPrice': 'Τιμή συσκευασίας',
    'list.unitPrice': 'Τιμή μονάδας',
    'list.noOffer': 'Δεν υπάρχει διαθέσιμη τιμή.',
    'list.ownerOnly': 'Μόνο ο ιδιοκτήτης μπορεί να αφαιρεί μέλη.',
    'catalog.title': 'Κατάλογος',
    'catalog.lead': 'Κάθε προϊόν εμφανίζεται μία φορά. Συγκρίνετε τιμές ανά κατάστημα.',
    'catalog.categories': 'Κατηγορίες',
    'catalog.categoryLead': 'Επιλέξτε κατηγορία ή αναζητήστε προϊόν.',
    'catalog.category': 'Κατηγορία',
    'catalog.allCategories': 'Όλες οι κατηγορίες',
    'catalog.subcategories': 'Υποκατηγορίες',
    'catalog.subcategoryLead': 'Επιλέξτε υποκατηγορία για πιο στοχευμένα αποτελέσματα.',
    'catalog.subcategory': 'Υποκατηγορία',
    'catalog.allSubcategories': 'Όλες οι υποκατηγορίες',
    'catalog.search': 'Αναζήτηση προϊόντων',
    'catalog.searchPlaceholder': 'Όνομα προϊόντος ή συσκευασία',
    'catalog.shop': 'Κατάστημα',
    'catalog.allShops': 'Όλα τα καταστήματα',
    'catalog.sort': 'Ταξινόμηση',
    'catalog.cheapest': 'Χαμηλότερη τιμή',
    'catalog.name': 'Όνομα',
    'catalog.results': 'Αποτελέσματα',
    'catalog.resultCount': '{count} προϊόντα',
    'catalog.offerCount': '{count} τιμές',
    'catalog.fromPrice': 'Από',
    'catalog.noResults': 'Δεν βρέθηκαν προϊόντα για αυτά τα φίλτρα.',
    'catalog.loading': 'Φόρτωση προϊόντων…',
    'catalog.back': 'Πίσω στην κατηγορία',
    'catalog.addTo': 'Προσθήκη στη λίστα',
    'catalog.noList': 'Δημιουργήστε ή ανοίξτε λίστα πριν προσθέσετε προϊόν.',
    'catalog.openList': 'Άνοιγμα λίστας',
    'catalog.showBasket': 'Εμφάνιση λίστας',
    'catalog.hideBasket': 'Απόκρυψη λίστας',
    'lists.confirmDelete': 'Να διαγραφεί οριστικά η ανοιχτή λίστα «{title}»;',
    'history.title': 'Ιστορικό',
    'history.lead': 'Οι αποθηκευμένες λίστες κρατούν τις τιμές της ημέρας αποθήκευσης.',
    'history.empty': 'Δεν υπάρχουν αποθηκευμένες λίστες ακόμη.',
    'history.savedBy': 'Αποθηκεύτηκε από {name}',
    'history.savedOn': 'Αποθηκεύτηκε {date}',
    'notices.title': 'Ειδοποιήσεις',
    'notices.lead': 'Ενημερώσεις από άλλα μέλη των κοινόχρηστων λιστών σας.',
    'notices.empty': 'Δεν υπάρχουν ειδοποιήσεις ακόμη.',
    'notices.loading': 'Φόρτωση ειδοποιήσεων…',
    'notices.error': 'Δεν ήταν δυνατή η φόρτωση των ειδοποιήσεων.',
    'auth.login': 'Σύνδεση',
    'auth.loginLead': 'Ανοίξτε τις κοινόχρηστες λίστες σας.',
    'auth.register': 'Εγγραφή',
    'auth.registerLead': 'Δημιουργήστε λογαριασμό για να μοιραστείτε λίστες.',
    'auth.name': 'Όνομα',
    'auth.email': 'Email',
    'auth.password': 'Κωδικός πρόσβασης',
    'auth.passwordHint': 'Τουλάχιστον 10 χαρακτήρες.',
    'auth.createAccount': 'Δημιουργία λογαριασμού',
    'auth.noAccount': 'Δεν έχετε λογαριασμό;',
    'auth.hasAccount': 'Έχετε ήδη λογαριασμό;',
    'auth.registerLink': 'Εγγραφή',
    'auth.loginLink': 'Σύνδεση',
    'auth.emailSent': 'Ο λογαριασμός δημιουργήθηκε.',
    'auth.emailNotSent': 'Δεν στάλθηκε email επιβεβαίωσης από αυτή τη συσκευή.',
    'error.searchLength': 'Πληκτρολογήστε τουλάχιστον δύο γράμματα.',
    'error.load': 'Η φόρτωση απέτυχε. Δοκιμάστε ξανά.',
    'error.save': 'Η αποθήκευση απέτυχε. Δοκιμάστε ξανά.',
  },
  en: {
    'nav.home': 'Home',
    'nav.catalog': 'Catalog',
    'nav.lists': 'Lists',
    'nav.history': 'History',
    'nav.notices': 'Notices',
    'nav.close': 'Close menu',
    'nav.menu': 'Menu',
    'nav.shoppingList': 'Shopping list',
    'nav.where': 'Where you are',
    'lang.switch': 'Change language',
    'brand.tagline': 'Compare prices and keep shared shopping organised.',
    'action.logout': 'Log out',
    'action.create': 'Create',
    'action.join': 'Join',
    'action.open': 'Open',
    'action.search': 'Search',
    'action.apply': 'Apply',
    'action.add': 'Add',
    'action.addProduct': 'Add product',
    'action.chooseOffer': 'Choose price',
    'action.confirm': 'Confirm',
    'action.cancel': 'Cancel',
    'action.remove': 'Remove',
    'action.delete': 'Delete',
    'action.copy': 'Copy',
    'action.previous': 'Previous',
    'action.next': 'Next',
    'action.saveList': 'Save list',
    'action.createList': 'New list',
    'action.showAll': 'View all',
    'common.products': '{count} products',
    'common.product': '{count} product',
    'common.people': '{count} people',
    'common.peopleOne': '{count} person',
    'common.someone': 'a member',
    'common.offers': '{count} shops',
    'common.owner': 'Owner',
    'common.editor': 'Member',
    'common.open': 'Open',
    'common.saved': 'Saved',
    'common.loading': 'Loading…',
    'common.total': 'Total',
    'common.updated': 'Updated',
    'home.title': 'My lists',
    'home.lead': 'Shared lists and shopping, together in one place.',
    'home.openLists': 'Open lists',
    'home.savedLists': 'Saved lists',
    'home.openLead': 'Continue with your most recent list.',
    'home.savedLead': 'Prices stay as they were when each list was saved.',
    'home.noOpen': 'There are no open lists.',
    'home.noSaved': 'There are no saved lists.',
    'home.noItems': 'No products have been added.',
    'home.browse': 'Browse the catalog',
    'home.loading': 'Loading lists…',
    'home.error': 'The lists could not be loaded.',
    'lists.title': 'Lists',
    'lists.lead': 'Create a list or join one with an invite code.',
    'lists.newTitle': 'New list',
    'lists.titleLabel': 'List name',
    'lists.titlePlaceholder': 'e.g. Weekly shopping',
    'lists.inviteLabel': 'Invite code',
    'lists.joinLead': 'Have a code? Join an open list.',
    'lists.noLists': 'No open lists yet. Create one or join with a code.',
    'lists.loading': 'Loading lists…',
    'lists.error': 'The lists could not be loaded.',
    'lists.created': 'The list was created.',
    'lists.joined': 'You joined the list.',
    'lists.copySuccess': 'Invite code copied.',
    'list.back': 'Back to lists',
    'list.openLead': 'Members can add, change, or remove products while the list is open.',
    'list.savedLead': 'Prices and the save date stay fixed.',
    'list.members': 'Members',
    'list.inviteCode': 'Invite code',
    'list.copyCode': 'Copy code',
    'list.removeMember': 'Remove member',
    'list.removeMemberConfirm': 'Remove {member} from “{list}”?',
    'list.memberRemoved': 'The member was removed.',
    'list.addProduct': 'Add a product',
    'list.searchPlaceholder': 'Product name or pack size',
    'list.searchHint': 'Search for a product and compare shop prices before adding it.',
    'list.noResults': 'No catalog products matched that name.',
    'list.results': 'Results',
    'list.onList': 'On the list',
    'list.empty': 'Nothing here yet. Search for a product to get started.',
    'list.saveLead': 'Saving keeps the current prices and locks the list.',
    'list.savedNotice': 'The list was saved with current prices.',
    'list.added': 'Added {product}.',
    'list.quantity': 'Quantity',
    'list.quantityWhole': 'Quantity must be a whole number from 1 to 9999.',
    'list.priceByStore': 'Price by shop',
    'list.chooseStore': 'Choose a shop',
    'list.packPrice': 'Pack price',
    'list.unitPrice': 'Unit price',
    'list.noOffer': 'No price is available.',
    'list.ownerOnly': 'Only the owner can remove members.',
    'catalog.title': 'Catalog',
    'catalog.lead': 'Each product appears once. Compare prices by shop.',
    'catalog.categories': 'Categories',
    'catalog.categoryLead': 'Choose a category or search for a product.',
    'catalog.category': 'Category',
    'catalog.allCategories': 'All categories',
    'catalog.subcategories': 'Subcategories',
    'catalog.subcategoryLead': 'Choose a subcategory to narrow down the results.',
    'catalog.subcategory': 'Subcategory',
    'catalog.allSubcategories': 'All subcategories',
    'catalog.search': 'Search products',
    'catalog.searchPlaceholder': 'Product name or pack size',
    'catalog.shop': 'Shop',
    'catalog.allShops': 'All shops',
    'catalog.sort': 'Sort',
    'catalog.cheapest': 'Lowest price',
    'catalog.name': 'Name',
    'catalog.results': 'Results',
    'catalog.resultCount': '{count} products',
    'catalog.offerCount': '{count} prices',
    'catalog.fromPrice': 'From',
    'catalog.noResults': 'No products match these filters.',
    'catalog.loading': 'Loading products…',
    'catalog.back': 'Back to category',
    'catalog.addTo': 'Add to list',
    'catalog.noList': 'Create or open a list before adding a product.',
    'catalog.openList': 'Open list',
    'catalog.showBasket': 'Show list',
    'catalog.hideBasket': 'Hide list',
    'lists.confirmDelete': 'Permanently delete the open list “{title}”?',
    'history.title': 'History',
    'history.lead': 'Saved lists keep the prices from the day they were saved.',
    'history.empty': 'There are no saved lists yet.',
    'history.savedBy': 'Saved by {name}',
    'history.savedOn': 'Saved {date}',
    'notices.title': 'Notices',
    'notices.lead': 'Updates from other members of your shared lists.',
    'notices.empty': 'There are no notices yet.',
    'notices.loading': 'Loading notices…',
    'notices.error': 'The notices could not be loaded.',
    'auth.login': 'Log in',
    'auth.loginLead': 'Open the lists you share.',
    'auth.register': 'Register',
    'auth.registerLead': 'Create an account to share shopping lists.',
    'auth.name': 'Name',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.passwordHint': 'At least 10 characters.',
    'auth.createAccount': 'Create account',
    'auth.noAccount': 'No account yet?',
    'auth.hasAccount': 'Already have an account?',
    'auth.registerLink': 'Register',
    'auth.loginLink': 'Log in',
    'auth.emailSent': 'Your account is ready.',
    'auth.emailNotSent': 'A confirmation email was not sent from this device.',
    'error.searchLength': 'Type at least two letters.',
    'error.load': 'Loading failed. Try again.',
    'error.save': 'Saving failed. Try again.',
  },
} as const;

export type MessageKey = keyof typeof messages.en;

@Injectable({ providedIn: 'root' })
export class Language {
  private readonly storageKey = 'supermarket.language';
  readonly code = signal<LanguageCode>(this.readLanguage());

  constructor() {
    document.documentElement.lang = this.code();
  }

  setLanguage(code: LanguageCode): void {
    this.code.set(code);
    document.documentElement.lang = code;
    localStorage.setItem(this.storageKey, code);
  }

  toggle(): void {
    this.setLanguage(this.code() === 'el' ? 'en' : 'el');
  }

  translate(key: MessageKey, params: Record<string, string | number> = {}): string {
    let text: string = messages[this.code()][key];
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  }

  euro(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '—';
    }
    return new Intl.NumberFormat(this.code() === 'el' ? 'el-GR' : 'en-GB', {
      style: 'currency',
      currency: 'EUR',
    }).format(value);
  }

  quantity(value: string | number): string {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return '';
    }
    return new Intl.NumberFormat(this.code() === 'el' ? 'el-GR' : 'en-GB', {
      maximumFractionDigits: 0,
    }).format(number);
  }

  date(value: string | null): string {
    if (!value) {
      return '';
    }
    return new Intl.DateTimeFormat(this.code() === 'el' ? 'el-GR' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Athens',
    }).format(new Date(value));
  }

  private readLanguage(): LanguageCode {
    return localStorage.getItem(this.storageKey) === 'en' ? 'en' : 'el';
  }
}

@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  constructor(private readonly language: Language) {}

  transform(key: MessageKey, params?: Record<string, string | number>): string {
    return this.language.translate(key, params);
  }
}

@Pipe({ name: 'eur', standalone: true, pure: false })
export class EuroPipe implements PipeTransform {
  constructor(private readonly language: Language) {}

  transform(value: number | null | undefined): string {
    return this.language.euro(value);
  }
}

@Pipe({ name: 'quantity', standalone: true, pure: false })
export class QuantityPipe implements PipeTransform {
  constructor(private readonly language: Language) {}

  transform(value: string | number): string {
    return this.language.quantity(value);
  }
}

@Pipe({ name: 'when', standalone: true, pure: false })
export class WhenPipe implements PipeTransform {
  constructor(private readonly language: Language) {}

  transform(value: string | null): string {
    return this.language.date(value);
  }
}
