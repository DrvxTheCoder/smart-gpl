"use client";

import { HugeiconsIcon, type HugeiconsProps, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Activity01Icon,
  Agreement01Icon,
  Alert02Icon,
  Call02Icon,
  ChartLineData01Icon,
  DeliveryTruck01Icon,
  Exchange01Icon,
  InformationCircleIcon,
  Invoice01Icon,
  MinusSignIcon,
  PrinterIcon,
  RepeatIcon,
  ShoppingCart01Icon,
  Store01Icon,
  Target02Icon,
  UserGroupIcon,
  UserShield01Icon,
  Wallet01Icon,
  WarehouseIcon,
  WeightScaleIcon,
  WorkflowSquare03Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  ComputerIcon,
  CustomerSupportIcon,
  CylinderIcon,
  DashboardSquare01Icon,
  Delete02Icon,
  FileExportIcon,
  FileImportIcon,
  Factory01Icon,
  LogoutSquare02Icon,
  Menu09Icon,
  Moon02Icon,
  Notification01Icon,
  PaintBoardIcon,
  PauseIcon,
  PencilEdit02Icon,
  PlayIcon,
  PolyTankIcon,
  PreferenceHorizontalIcon,
  RotateLeft01Icon,
  Search01Icon,
  Settings02Icon,
  LayoutLeftIcon,
  LayoutRightIcon,
  SquareLock02Icon,
  TaskDaily01Icon,
  Tick02Icon,
  Xls02Icon,
  Location01Icon,
  UserIcon,
  Undo02Icon as Undo02Svg
} from "@hugeicons/core-free-icons";

export type IconProps = Omit<HugeiconsProps, "icon" | "ref">;
export type Icon = (props: IconProps) => React.JSX.Element;

/**
 * App-wide icon set, backed by Hugeicons. Each export is named for its role
 * so call sites read like components: <Plus className="size-4" />.
 */
const make = (svg: IconSvgElement): Icon => {
  const C = (props: IconProps) => <HugeiconsIcon icon={svg} {...props} />;
  return C;
};

// Navigation and shell
export const LayoutGrid = make(DashboardSquare01Icon);
export const ClipboardList = make(TaskDaily01Icon);
export const ChartColumn = make(Activity01Icon);
export const Settings2 = make(Settings02Icon);
export const LifeBuoy = make(CustomerSupportIcon);
export const LogOut = make(LogoutSquare02Icon);
export const Search = make(Search01Icon);
export const Bell = make(Notification01Icon);
export const Menu = make(Menu09Icon);
export const X = make(Cancel01Icon);
export const PanelLeftClose = make(LayoutRightIcon);
export const PanelLeftOpen = make(LayoutLeftIcon);

// Sales and warehouse
export const TrendingUp = make(ChartLineData01Icon);
export const ShoppingCart = make(ShoppingCart01Icon);
export const Users = make(UserGroupIcon);
export const Target = make(Target02Icon);
export const Store = make(Store01Icon);
export const Warehouse = make(WarehouseIcon);
export const Truck = make(DeliveryTruck01Icon);
export const FileText = make(Invoice01Icon);
export const Contract = make(Agreement01Icon);
export const Wallet = make(Wallet01Icon);
export const Phone = make(Call02Icon);
export const MapPin = make(Location01Icon);
export const User = make(UserIcon);
export const Scale = make(WeightScaleIcon);
export const Exchange = make(Exchange01Icon);
export const Workflow = make(WorkflowSquare03Icon);
export const ShieldUser = make(UserShield01Icon);
export const AlertCircle = make(Alert02Icon);
export const Info = make(InformationCircleIcon);

// Actions
export const Plus = make(Add01Icon);
export const Minus = make(MinusSignIcon);
export const Printer = make(PrinterIcon);
export const Repeat = make(RepeatIcon);
export const Trash2 = make(Delete02Icon);
export const Pencil = make(PencilEdit02Icon);
export const Check = make(Tick02Icon);
export const Download = make(FileExportIcon);
export const FileDown = make(FileExportIcon);
export const FileSpreadsheet = make(Xls02Icon);
export const FileUp = make(FileImportIcon);
export const Copy = make(Copy01Icon);
export const RotateCcw = make(RotateLeft01Icon);
export const Play = make(PlayIcon);
export const Pause = make(PauseIcon);
export const Lock = make(SquareLock02Icon);
export const Moon = make(Moon02Icon);

// Direction
export const ArrowLeft = make(ArrowLeft02Icon);
export const ChevronLeft = make(ArrowLeft01Icon);
export const ChevronRight = make(ArrowRight01Icon);
export const ChevronDown = make(ArrowDown01Icon);
export const ArrowDown = make(ArrowDown02Icon);

// Pickers
export const CalendarDays = make(Calendar03Icon);
export const Clock = make(Clock01Icon);

// Settings sections
export const Palette = make(PaintBoardIcon);
export const Factory = make(Factory01Icon);
export const Container = make(PolyTankIcon);
export const ArrowLeftRight = make(ArrowDataTransferHorizontalIcon);
export const Cylinder = make(CylinderIcon);
export const SlidersHorizontal = make(PreferenceHorizontalIcon);
export const Monitor = make(ComputerIcon);
export const Undo02Icon = make(Undo02Svg);
