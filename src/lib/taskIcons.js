import {
  PersonStanding,
  Dumbbell,
  Phone,
  Mail,
  Shirt,
  ShoppingCart,
  Sparkles,
  UtensilsCrossed,
  Coffee,
  BookOpen,
  Video,
  Receipt,
  Car,
  Home,
  Wrench,
  Dog,
  Cat,
  Baby,
  Stethoscope,
  Pill,
  GraduationCap,
  Briefcase,
  Laptop,
  Plane,
  Bus,
  Fuel,
  Wallet,
  CreditCard,
  Bed,
  ShowerHead,
  Trash2,
  Music,
  Camera,
  Gift,
  Scissors,
  Hammer,
  Paintbrush,
  Leaf,
  TreePine,
  Flower2,
  Users,
  MessageSquare,
  FileText,
  Calendar,
} from 'lucide-react'

// Keyword -> icon guesses for a task's title, in place of Structured's
// ML-trained "smart icon selection" — a curated map gets most of the
// same value ("what kind of task is this, at a glance") without the
// "donate your data to train the model" machinery, which is out of
// proportion for a two-person app. Checked in order, first match wins —
// a title is matched against `.includes()` on each entry's keywords, so
// more specific/common household vocabulary sits earlier deliberately
// (e.g. "call" before anything broader that might also appear in a
// call-related title). False positives (a keyword appearing as a
// substring of an unrelated word) are an accepted low-stakes tradeoff,
// same reasoning this app already applies to bulk-add's own text
// parsing — a task with a manually-picked icon (see resolveTaskIcon
// below) never reaches this map at all, so a bad guess is only ever a
// one-tap fix, not something to chase every edge case for up front.
const KEYWORD_ICONS = [
  { keywords: ['run', 'jog'], icon: PersonStanding },
  { keywords: ['gym', 'workout', 'exercise', 'abs', 'lift'], icon: Dumbbell },
  { keywords: ['call', 'phone'], icon: Phone },
  { keywords: ['email', 'mail'], icon: Mail },
  { keywords: ['laundry'], icon: Shirt },
  { keywords: ['groceries', 'grocery', 'shopping', 'shop for'], icon: ShoppingCart },
  { keywords: ['clean', 'tidy', 'vacuum'], icon: Sparkles },
  { keywords: ['cook', 'dinner', 'lunch', 'breakfast', 'meal'], icon: UtensilsCrossed },
  { keywords: ['coffee'], icon: Coffee },
  { keywords: ['read', 'book', 'study'], icon: BookOpen },
  { keywords: ['meeting', 'zoom', 'video call'], icon: Video },
  { keywords: ['bill', 'pay', 'invoice', 'rent'], icon: Receipt },
  { keywords: ['drive', 'car wash', 'oil change'], icon: Car },
  { keywords: ['chore', 'house'], icon: Home },
  { keywords: ['fix', 'repair'], icon: Wrench },
  { keywords: ['dog', 'walk the dog'], icon: Dog },
  { keywords: ['cat', 'litter'], icon: Cat },
  { keywords: ['baby', 'kid'], icon: Baby },
  { keywords: ['doctor', 'appointment', 'checkup'], icon: Stethoscope },
  { keywords: ['medicine', 'pill', 'vitamin', 'prescription'], icon: Pill },
  { keywords: ['class', 'school', 'homework', 'exam', 'lecture'], icon: GraduationCap },
  { keywords: ['work', 'project', 'deadline'], icon: Briefcase },
  { keywords: ['laptop', 'computer', 'code', 'website'], icon: Laptop },
  { keywords: ['flight', 'trip', 'travel', 'vacation'], icon: Plane },
  { keywords: ['bus', 'commute'], icon: Bus },
  { keywords: ['gas', 'fuel'], icon: Fuel },
  { keywords: ['budget', 'finance', 'save money'], icon: Wallet },
  { keywords: ['bank', 'credit card'], icon: CreditCard },
  { keywords: ['sleep', 'nap', 'bed'], icon: Bed },
  { keywords: ['shower', 'bath'], icon: ShowerHead },
  { keywords: ['trash', 'garbage'], icon: Trash2 },
  { keywords: ['practice', 'music', 'guitar', 'piano'], icon: Music },
  { keywords: ['photo', 'camera', 'pictures'], icon: Camera },
  { keywords: ['gift', 'present', 'birthday'], icon: Gift },
  { keywords: ['haircut', 'salon'], icon: Scissors },
  { keywords: ['build', 'construction'], icon: Hammer },
  { keywords: ['paint'], icon: Paintbrush },
  { keywords: ['garden', 'plant'], icon: Leaf },
  { keywords: ['yard', 'tree'], icon: TreePine },
  { keywords: ['flower'], icon: Flower2 },
  { keywords: ['friends', 'family', 'party'], icon: Users },
  { keywords: ['text', 'message'], icon: MessageSquare },
  { keywords: ['report', 'document', 'write'], icon: FileText },
  { keywords: ['schedule', 'plan'], icon: Calendar },
]

// The flat list TaskIconPicker.jsx renders/searches — every icon used
// above, each with one canonical display name (independent of the
// keyword map, which can have several keywords per icon) so the picker
// doesn't need to derive names from KEYWORD_ICONS at all.
export const TASK_ICON_OPTIONS = [
  { name: 'Running', icon: PersonStanding },
  { name: 'Workout', icon: Dumbbell },
  { name: 'Phone call', icon: Phone },
  { name: 'Email', icon: Mail },
  { name: 'Laundry', icon: Shirt },
  { name: 'Shopping', icon: ShoppingCart },
  { name: 'Cleaning', icon: Sparkles },
  { name: 'Cooking', icon: UtensilsCrossed },
  { name: 'Coffee', icon: Coffee },
  { name: 'Reading', icon: BookOpen },
  { name: 'Video call', icon: Video },
  { name: 'Bill / payment', icon: Receipt },
  { name: 'Car', icon: Car },
  { name: 'Home / chore', icon: Home },
  { name: 'Repair', icon: Wrench },
  { name: 'Dog', icon: Dog },
  { name: 'Cat', icon: Cat },
  { name: 'Baby / kid', icon: Baby },
  { name: 'Doctor', icon: Stethoscope },
  { name: 'Medicine', icon: Pill },
  { name: 'School', icon: GraduationCap },
  { name: 'Work', icon: Briefcase },
  { name: 'Computer', icon: Laptop },
  { name: 'Travel', icon: Plane },
  { name: 'Bus / commute', icon: Bus },
  { name: 'Gas', icon: Fuel },
  { name: 'Budget', icon: Wallet },
  { name: 'Bank card', icon: CreditCard },
  { name: 'Sleep', icon: Bed },
  { name: 'Shower', icon: ShowerHead },
  { name: 'Trash', icon: Trash2 },
  { name: 'Music', icon: Music },
  { name: 'Photo', icon: Camera },
  { name: 'Gift', icon: Gift },
  { name: 'Haircut', icon: Scissors },
  { name: 'Build', icon: Hammer },
  { name: 'Paint', icon: Paintbrush },
  { name: 'Garden', icon: Leaf },
  { name: 'Yard', icon: TreePine },
  { name: 'Flower', icon: Flower2 },
  { name: 'People', icon: Users },
  { name: 'Message', icon: MessageSquare },
  { name: 'Document', icon: FileText },
  { name: 'Calendar', icon: Calendar },
]

const ICON_BY_NAME = Object.fromEntries(TASK_ICON_OPTIONS.map((o) => [o.name, o.icon]))

// First keyword match against the lowercased title, or null — never a
// fallback icon of its own. Null is meaningful: it tells TaskIcon.jsx
// "nothing to guess here," so it can fall back to the existing
// PriorityDot instead of forcing every unmatched task to show the same
// generic icon.
export function guessTaskIcon(title) {
  const lower = (title || '').toLowerCase()
  for (const entry of KEYWORD_ICONS) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.icon
  }
  return null
}

// task.icon (a manually-picked name from TASK_ICON_OPTIONS, set via
// TaskIconPicker.jsx) wins over the live keyword guess — once someone
// corrects a wrong guess or picks one for a title with no match at all,
// that choice sticks regardless of later title edits. Falls through to
// the keyword guess, then null (see guessTaskIcon above) when task.icon
// is unset — the guess is never persisted on its own, so it can keep
// improving later without touching existing rows.
export function resolveTaskIcon(task) {
  if (task?.icon && ICON_BY_NAME[task.icon]) return ICON_BY_NAME[task.icon]
  return guessTaskIcon(task?.title)
}
