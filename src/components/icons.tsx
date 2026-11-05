// The app's icons, in one place. Heroicons (outline, 24px grid) for everything it has; Lucide, drawn at the same
// 1.5px line, only for what Heroicons lacks (mostly game icons: swords, potions, shields, coins). Screens import from
// here, never from an icon pack (src/components/icons.test.tsx), so swapping one icon is a one-line change.
// Every icon takes `size` (px, default 24) and is decorative (aria-hidden) unless it is given an aria-label.
import { forwardRef, type ComponentType, type SVGProps } from "react";
import {
  AcademicCapIcon as HAcademicCap,
  ArrowDownIcon as HArrowDown,
  ArrowDownTrayIcon as HArrowDownTray,
  ArrowLeftIcon as HArrowLeft,
  ArrowPathIcon as HArrowPath,
  ArrowPathRoundedSquareIcon as HArrowPathRoundedSquare,
  ArrowRightEndOnRectangleIcon as HArrowRightEndOnRectangle,
  ArrowRightIcon as HArrowRight,
  ArrowRightStartOnRectangleIcon as HArrowRightStartOnRectangle,
  ArrowTrendingUpIcon as HArrowTrendingUp,
  ArrowUpIcon as HArrowUp,
  ArrowUpTrayIcon as HArrowUpTray,
  ArrowUturnLeftIcon as HArrowUturnLeft,
  ArrowsRightLeftIcon as HArrowsRightLeft,
  BeakerIcon as HBeaker,
  BoltIcon as HBolt,
  BookOpenIcon as HBookOpen,
  BookmarkSquareIcon as HBookmarkSquare,
  BuildingStorefrontIcon as HBuildingStorefront,
  CalendarDaysIcon as HCalendarDays,
  ChatBubbleLeftRightIcon as HChatBubbleLeftRight,
  CheckCircleIcon as HCheckCircle,
  CheckIcon as HCheck,
  ChevronDoubleRightIcon as HChevronDoubleRight,
  ChevronDownIcon as HChevronDown,
  ChevronLeftIcon as HChevronLeft,
  ChevronRightIcon as HChevronRight,
  ChevronUpDownIcon as HChevronUpDown,
  CircleStackIcon as HCircleStack,
  ClockIcon as HClock,
  Cog6ToothIcon as HCog6Tooth,
  ComputerDesktopIcon as HComputerDesktop,
  CreditCardIcon as HCreditCard,
  CubeIcon as HCube,
  DevicePhoneMobileIcon as HDevicePhoneMobile,
  DocumentArrowUpIcon as HDocumentArrowUp,
  DocumentDuplicateIcon as HDocumentDuplicate,
  DocumentTextIcon as HDocumentText,
  EnvelopeIcon as HEnvelope,
  ExclamationCircleIcon as HExclamationCircle,
  ExclamationTriangleIcon as HExclamationTriangle,
  EyeIcon as HEye,
  EyeSlashIcon as HEyeSlash,
  FireIcon as HFire,
  FlagIcon as HFlag,
  FolderPlusIcon as HFolderPlus,
  HandRaisedIcon as HHandRaised,
  HeartIcon as HHeart,
  InboxIcon as HInbox,
  InformationCircleIcon as HInformationCircle,
  KeyIcon as HKey,
  LightBulbIcon as HLightBulb,
  ListBulletIcon as HListBullet,
  LockClosedIcon as HLockClosed,
  MagnifyingGlassIcon as HMagnifyingGlass,
  MapIcon as HMap,
  MinusCircleIcon as HMinusCircle,
  MinusIcon as HMinus,
  MoonIcon as HMoon,
  NoSymbolIcon as HNoSymbol,
  PaperAirplaneIcon as HPaperAirplane,
  PencilIcon as HPencil,
  PencilSquareIcon as HPencilSquare,
  PlusIcon as HPlus,
  QuestionMarkCircleIcon as HQuestionMarkCircle,
  QueueListIcon as HQueueList,
  RectangleStackIcon as HRectangleStack,
  ScissorsIcon as HScissors,
  ShareIcon as HShare,
  ShieldCheckIcon as HShieldCheck,
  ShoppingBagIcon as HShoppingBag,
  SignalSlashIcon as HSignalSlash,
  SparklesIcon as HSparkles,
  StarIcon as HStar,
  SunIcon as HSun,
  TicketIcon as HTicket,
  TrashIcon as HTrash,
  TrophyIcon as HTrophy,
  UserCircleIcon as HUserCircle,
  UserIcon as HUser,
  UsersIcon as HUsers,
  XCircleIcon as HXCircle,
  XMarkIcon as HXMark,
} from "@heroicons/react/24/outline";
import {
  Award as LAward,
  Backpack as LBackpack,
  BedDouble as LBedDouble,
  Brain as LBrain,
  Circle as LCircle,
  Coins as LCoins,
  CornerDownLeft as LCornerDownLeft,
  Crosshair as LCrosshair,
  Crown as LCrown,
  Droplets as LDroplets,
  Feather as LFeather,
  FileWarning as LFileWarning,
  FileX as LFileX,
  Gauge as LGauge,
  Gem as LGem,
  Hammer as LHammer,
  HeartPulse as LHeartPulse,
  History as LHistory,
  Hourglass as LHourglass,
  Loader2 as LLoader2,
  MailCheck as LMailCheck,
  Mountain as LMountain,
  PanelLeft as LPanelLeft,
  PawPrint as LPawPrint,
  Save as LSave,
  ScrollText as LScrollText,
  SearchX as LSearchX,
  Shield as LShield,
  ShieldHalf as LShieldHalf,
  ShieldPlus as LShieldPlus,
  Skull as LSkull,
  SunMoon as LSunMoon,
  Sword as LSword,
  Swords as LSwords,
  Target as LTarget,
  Type as LType,
  UserCog as LUserCog,
} from "lucide-react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  /** Width and height in px. */
  size?: number | string;
  strokeWidth?: number | string;
}
export type IconType = ComponentType<IconProps>;

/** 1.5px like Heroicons; a little heavier at 16px and below so small icons stay crisp. */
const weight = (size: number | string, strokeWidth?: number | string) => strokeWidth ?? (Number(size) <= 16 ? 2 : 1.5);
const a11y = (p: IconProps) => (p["aria-label"] ? { role: "img", "aria-hidden": p["aria-hidden"] ?? undefined } : { "aria-hidden": p["aria-hidden"] ?? true });

type Raw = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>;
function hero(Svg: Raw, name: string): IconType {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ size = 24, strokeWidth, ...p }, ref) => (
    <Svg ref={ref as never} width={size} height={size} strokeWidth={weight(size, strokeWidth)} data-icon-pack="heroicons" {...a11y(p)} {...p} />
  ));
  Icon.displayName = name;
  return Icon as IconType;
}
type LucideRaw = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string; absoluteStrokeWidth?: boolean }>;
function lucide(Svg: LucideRaw, name: string): IconType {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ size = 24, strokeWidth, ...p }, ref) => (
    <Svg ref={ref as never} size={size} strokeWidth={weight(size, strokeWidth)} data-icon-pack="lucide" {...a11y(p)} {...p} />
  ));
  Icon.displayName = name;
  return Icon as IconType;
}

export const AlertCircle = hero(HExclamationCircle, "AlertCircle");
export const AlertTriangle = hero(HExclamationTriangle, "AlertTriangle");
export const ArrowDown = hero(HArrowDown, "ArrowDown");
export const ArrowLeft = hero(HArrowLeft, "ArrowLeft");
export const ArrowRight = hero(HArrowRight, "ArrowRight");
export const ArrowUp = hero(HArrowUp, "ArrowUp");
export const Ban = hero(HNoSymbol, "Ban");
export const BookMarked = hero(HBookmarkSquare, "BookMarked");
export const BookOpen = hero(HBookOpen, "BookOpen");
export const CalendarClock = hero(HCalendarDays, "CalendarClock");
export const Check = hero(HCheck, "Check");
export const CheckCircle = hero(HCheckCircle, "CheckCircle");
export const CheckCircle2 = hero(HCheckCircle, "CheckCircle2");
export const ChevronDown = hero(HChevronDown, "ChevronDown");
export const ChevronLeft = hero(HChevronLeft, "ChevronLeft");
export const ChevronRight = hero(HChevronRight, "ChevronRight");
export const ChevronsRight = hero(HChevronDoubleRight, "ChevronsRight");
export const ChevronsUpDown = hero(HChevronUpDown, "ChevronsUpDown");
export const CircleHelp = hero(HQuestionMarkCircle, "CircleHelp");
export const Clock = hero(HClock, "Clock");
export const Copy = hero(HDocumentDuplicate, "Copy");
export const CreditCard = hero(HCreditCard, "CreditCard");
export const Database = hero(HCircleStack, "Database");
export const Download = hero(HArrowDownTray, "Download");
export const Eye = hero(HEye, "Eye");
export const EyeOff = hero(HEyeSlash, "EyeOff");
export const FileText = hero(HDocumentText, "FileText");
export const FileUp = hero(HDocumentArrowUp, "FileUp");
export const Flag = hero(HFlag, "Flag");
export const Flame = hero(HFire, "Flame");
export const FlaskConical = hero(HBeaker, "FlaskConical");
export const FolderPlus = hero(HFolderPlus, "FolderPlus");
export const GraduationCap = hero(HAcademicCap, "GraduationCap");
export const HandGrab = hero(HHandRaised, "HandGrab");
export const Heart = hero(HHeart, "Heart");
export const HelpCircle = hero(HQuestionMarkCircle, "HelpCircle");
export const Inbox = hero(HInbox, "Inbox");
export const Info = hero(HInformationCircle, "Info");
export const KeyRound = hero(HKey, "KeyRound");
export const Layers = hero(HRectangleStack, "Layers");
export const Lightbulb = hero(HLightBulb, "Lightbulb");
export const List = hero(HListBullet, "List");
export const ListChecks = hero(HQueueList, "ListChecks");
export const Lock = hero(HLockClosed, "Lock");
export const LogIn = hero(HArrowRightEndOnRectangle, "LogIn");
export const LogOut = hero(HArrowRightStartOnRectangle, "LogOut");
export const Mail = hero(HEnvelope, "Mail");
export const Map = hero(HMap, "Map");
export const MessageSquare = hero(HChatBubbleLeftRight, "MessageSquare");
export const Minus = hero(HMinus, "Minus");
export const MinusCircle = hero(HMinusCircle, "MinusCircle");
export const Monitor = hero(HComputerDesktop, "Monitor");
export const MonitorSmartphone = hero(HDevicePhoneMobile, "MonitorSmartphone");
export const Moon = hero(HMoon, "Moon");
export const Network = hero(HShare, "Network");
export const NotebookPen = hero(HPencilSquare, "NotebookPen");
export const Package = hero(HCube, "Package");
export const Pencil = hero(HPencil, "Pencil");
export const Plus = hero(HPlus, "Plus");
export const RefreshCw = hero(HArrowPath, "RefreshCw");
export const Repeat = hero(HArrowPathRoundedSquare, "Repeat");
export const RotateCcw = hero(HArrowUturnLeft, "RotateCcw");
export const Scissors = hero(HScissors, "Scissors");
export const Search = hero(HMagnifyingGlass, "Search");
export const Send = hero(HPaperAirplane, "Send");
export const Settings = hero(HCog6Tooth, "Settings");
export const ShieldCheck = hero(HShieldCheck, "ShieldCheck");
export const ShoppingBag = hero(HShoppingBag, "ShoppingBag");
export const Shuffle = hero(HArrowsRightLeft, "Shuffle");
export const Sparkles = hero(HSparkles, "Sparkles");
export const Star = hero(HStar, "Star");
export const Store = hero(HBuildingStorefront, "Store");
export const Sun = hero(HSun, "Sun");
export const Ticket = hero(HTicket, "Ticket");
export const Trash2 = hero(HTrash, "Trash2");
export const TrendingUp = hero(HArrowTrendingUp, "TrendingUp");
export const Trophy = hero(HTrophy, "Trophy");
export const Upload = hero(HArrowUpTray, "Upload");
export const User = hero(HUser, "User");
export const UserCircle = hero(HUserCircle, "UserCircle");
export const Users = hero(HUsers, "Users");
export const WifiOff = hero(HSignalSlash, "WifiOff");
export const X = hero(HXMark, "X");
export const XCircle = hero(HXCircle, "XCircle");
export const Zap = hero(HBolt, "Zap");
export const Award = lucide(LAward, "Award");
export const Backpack = lucide(LBackpack, "Backpack");
export const BedDouble = lucide(LBedDouble, "BedDouble");
export const Brain = lucide(LBrain, "Brain");
export const Circle = lucide(LCircle, "Circle");
export const Coins = lucide(LCoins, "Coins");
export const CornerDownLeft = lucide(LCornerDownLeft, "CornerDownLeft");
export const Crosshair = lucide(LCrosshair, "Crosshair");
export const Crown = lucide(LCrown, "Crown");
export const Droplets = lucide(LDroplets, "Droplets");
export const Feather = lucide(LFeather, "Feather");
export const FileWarning = lucide(LFileWarning, "FileWarning");
export const FileX = lucide(LFileX, "FileX");
export const Gauge = lucide(LGauge, "Gauge");
export const Gem = lucide(LGem, "Gem");
export const Hammer = lucide(LHammer, "Hammer");
export const HeartPulse = lucide(LHeartPulse, "HeartPulse");
export const History = lucide(LHistory, "History");
export const Hourglass = lucide(LHourglass, "Hourglass");
export const Loader2 = lucide(LLoader2, "Loader2");
export const MailCheck = lucide(LMailCheck, "MailCheck");
export const Mountain = lucide(LMountain, "Mountain");
export const PanelLeft = lucide(LPanelLeft, "PanelLeft");
export const PawPrint = lucide(LPawPrint, "PawPrint");
export const Save = lucide(LSave, "Save");
export const ScrollText = lucide(LScrollText, "ScrollText");
export const SearchX = lucide(LSearchX, "SearchX");
export const Shield = lucide(LShield, "Shield");
export const ShieldHalf = lucide(LShieldHalf, "ShieldHalf");
export const ShieldPlus = lucide(LShieldPlus, "ShieldPlus");
export const Skull = lucide(LSkull, "Skull");
export const SunMoon = lucide(LSunMoon, "SunMoon");
export const Sword = lucide(LSword, "Sword");
export const Swords = lucide(LSwords, "Swords");
export const Target = lucide(LTarget, "Target");
export const Type = lucide(LType, "Type");
export const UserCog = lucide(LUserCog, "UserCog");
