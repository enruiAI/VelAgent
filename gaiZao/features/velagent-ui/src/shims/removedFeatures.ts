/**
 * removedFeatures —— 被删掉的功能（编译 / 仿真 / 云项目 / 串口 / 示波器 / 自定义芯片 …）
 * 留下的空实现。
 *
 * 这个文件存在的唯一目的：让保留下来的画布 UI（SimulatorCanvas / DynamicComponent /
 * useSimulatorStore）还能通过类型检查和打包。这里的所有导出都是空的 / 常量，
 * 运行时不做事，也不会去连任何后端。
 *
 * 想彻底删掉画布里的历史功能时，按下面的名字逐个清掉引用即可。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand';

const noop: any = (..._args: any[]): any => undefined;
/** 对任何属性都返回空函数的对象：给"注册表/动作集合"这类被属性调用的空实现用。 */
const noopProxy: any = new Proxy(
  {},
  {
    get: () => noop,
    has: () => true,
  },
);

/** 返回一个"任何方法调用都是空操作"的实例：给被 store 实例化的仿真引擎类用。 */
const noopInstanceClass: any = class {
  constructor(..._args: any[]) {
    return new Proxy(this, {
      get: (target: any, prop: string | symbol) => {
        if (prop in target) return target[prop];
        if (typeof prop === 'symbol') return undefined;
        return noop;
      },
    });
  }
};
const emptyObj: any = {};
const EmptyComponent: any = () => null;

// ── 空的 zustand store（电气仿真 / 示波器）──────────────────────────────────
export const useElectricalStore: any = create(() => ({
  paused: false,
  submittedNetlist: '',
  pinNetMap: {} as Record<string, string>,
  enabled: false,
  setEnabled: noop,
  setPaused: noop,
}));

export const useOscilloscopeStore: any = create(() => ({
  open: false,
  channels: [] as any[],
  openOscilloscope: noop,
  closeOscilloscope: noop,
  toggleOscilloscope: noop,
}));

// ── 仿真引擎（全部为空壳）─────────────────────────────────────────────────────
export const AVRSimulator: any = noopInstanceClass;
export const RP2040Simulator: any = noopInstanceClass;
export const RiscVSimulator: any = noopInstanceClass;
export const Esp32C3Simulator: any = noopInstanceClass;
export const RaspberryPi3Bridge: any = noopInstanceClass;
export const PiBridgeShim: any = noopInstanceClass;
export const Esp32Bridge: any = noopInstanceClass;
export const createEsp32Bridge: any = noop;
export const Stm32Bridge: any = noopInstanceClass;
export const stm32PinNameToLinear: any = noop;
export const PinManager: any = class {
  constructor() {
    const unsub = () => undefined;
    const base: any = {
      onPinChange: () => unsub,
      onPinConfigChange: () => unsub,
      onPinEvent: () => unsub,
      subscribe: () => unsub,
      getPinState: () => false,
      getOutputPins: () => [] as number[],
      getPinVoltage: () => 0,
      setPinState: () => undefined,
      reset: () => undefined,
      dispose: () => undefined,
    };
    return new Proxy(base, { get: (t: any, prop: string | symbol) => (prop in t ? t[prop] : noop) });
  }
};
export const ExternalPinScopeFeed: any = noopInstanceClass;
export const SignalRouter: any = noopInstanceClass;
export const RemoteI2cLane: any = noopInstanceClass;
export const RemoteUartLane: any = noopInstanceClass;
export const RemoteSpiLane: any = noopInstanceClass;
export const I2cEchoListeners: any = noopInstanceClass;
export const SdSpiCard: any = noopInstanceClass;
export const busRegistry: any = noopProxy;
export const remotePullLane: any = noop;
export const attachSpiDevice: any = noop;
export const createStoreNetResolver: any = noop;
export const loadSdBusChip: any = noop;
export const sdCardRemoteBlobWrite: any = noop;
export const sdCardHasRemoteModel: any = noop;
export const sdCardRemoteModel: any = noop;
export const sdSpiFabricDevice: any = noop;
export const requestElectricalResolve: any = noop;
export const requestElectricalPreview: any = noop;
export const ledcSignalForChannel: any = noop;
export const attachSlavesFromCanvas: any = noop;
export const traceBoardGpio: any = noop;
export const traceDetailed: any = noop;
export const getBoardLogicFamily: any = noop;
export const getMixedModeScheduler: any = noop;
export const withPartPinOwnership: any = noop;
export const releasePartPins: any = noop;
export const boardPinGroupFor: any = noop;
export const createDefaultPinResolver: any = noop;
export const createSpiceResolvedPinResolver: any = noop;
export const configFromLogicFamily: any = noop;
export const dispatchSensorUpdate: any = noop;
export const getSensorUpdate: any = noop;
export const isReplayingProjectValues: any = noop;
export const replayProjectSensorValues: any = noop;
export const replayProjectSensorValuesOnAttach: any = noop;
export const SENSOR_CONTROLS: any = emptyObj;
export const getSensorControl: any = noop;
export const getSensorControlForComponent: any = (..._a: any[]): any => null;
export const projectSensorValues: any = noop;
export const SINGLE_WIRE_SENSOR_MODELS: any = emptyObj;
export const i2cPartWorkerPin: any = noop;
export const parseI2cAddress: any = noop;
export const reensureSerialHooks: any = noop;
export const bindBoard: any = noop;
export const unbindBoard: any = noop;
export const updateWires: any = noop;
export const setInterconnectRuntime: any = noop;
export const createSerialBatcher: any = noop;
export const emitSerialTap: any = noop;
export const applySerialWireDisplay: any = noop;
export const applySerialWireTransmit: any = noop;
export const nominalBaud: any = (): number => 9600;
export const attachOnboardLeds: any = (..._a: any[]): any => () => undefined;
export const sameLedVisual: any = (): boolean => true;
export const remoteBoardActions: any = (..._a: any[]): any => ({ start: [] as string[], stop: [] as string[] });
export const resolveProbe: any = (..._a: any[]): any => null;
export const isSpiceMapped: any = (..._a: any[]): boolean => false;
export const mountDigitalGateEngine: any = noop;
export const getTabSessionId: any = (): string => '';
export const pinStateEchoHandler: any = noop;

// ── 自定义芯片 / 芯片源码文件（对应原来的 services/chipFiles）────────────────
export const seedChipFileGroups: any = noop;
export const isChipSourceFile: any = (): boolean => false;
export const installChipFileSync: any = noop;
export const flushChipFileSync: any = noop;
export const ensureChipWasm: any = noop;
export const isProgrammableChip: any = (): boolean => false;
export const normalizeChipPins: any = (pins: unknown): string[] =>
  Array.isArray(pins) ? (pins as string[]).map((p) => String(p ?? '')) : [];

// ── 板卡 flash / 桌面壳（原 lib/flashRequest、desktop/tauriBridge）───────────
export const OPEN_FLASH_EVENT = 'velxio:open-flash';
export const requestFlashDialog: any = noop;
// 本 build 没有编译/烧录：返回"不支持"而不是 null（调用方会读 .route / .disabled）
export const boardFlashSupport: any = (..._a: any[]): any => ({ route: null, disabled: true, micropython: false });
export const isTauri: any = (): boolean => false;
export const openDeviceGateway: any = noop;
export const trackSelectBoard: any = noop;
export const trackAddComponent: any = noop;
export const trackCreateWire: any = noop;
export const trackToggleSerialMonitor: any = noop;

// ── 被删掉的 React 组件：渲染为空 ────────────────────────────────────────────
export const FlashModal: any = EmptyComponent;
export const CustomChipDialog: any = EmptyComponent;
export const SensorControlPanel: any = EmptyComponent;
export const InstrumentComponent: any = EmptyComponent;
export const ElectricalOverlay: any = EmptyComponent;
export const ComponentCameraToggles: any = EmptyComponent;
export const PartInspectorDialog: any = EmptyComponent;
export const NewsAnnouncer: any = EmptyComponent;
export const ShareModal: any = EmptyComponent;

// ── 类型 ──────────────────────────────────────────────────────────────────────
export type Ws2812Pixel = any;
export type LineSupport = any;
export type RemotePullLane = any;
export type SerialLink = any;
export type PropertyChangeDetail = any;
export type InspectorAction = any;
export type OpenFlashDetail = any;
export type PinResolver = any;
export type BoardPinFunctions = any;
export type BusKind = any;
export type BuildNetlistInput = any;
export type AnalysisMode = any;
export type EPaperPanelConfig = any;

// ── 零件仿真注册表（空实现）──────────────────────────────────────────────────
export const PartSimulationRegistry: any = {
  get: (): any => undefined,
  register: noop,
  has: (): boolean => false,
};
export const PROPERTY_CHANGE_EVENT = 'velxio:property-change';
export const getBoardPinFunctions: any = (..._a: any[]): any => null;

// ── 板载摄像头 / 麦克风 / 传感器控件（已随仿真一起删除）──────────────────────
export const CameraToggle: any = EmptyComponent;
export const MicrophoneToggle: any = EmptyComponent;
export const BoardSensorControls: any = EmptyComponent;
export const SdCardPanel: any = EmptyComponent;

// ── MicroPython 固件加载（原 simulation/Esp32MicroPythonLoader）────────────────
export const getEsp32Firmware: any = async () => new Uint8Array();
export const padToFlashSize: any = (b: Uint8Array) => b;
export const uint8ArrayToBase64: any = () => '';
export type EngineBinding = any;
export type BoardPins = any;

// ── 串口 TX 拦截（原 lib/proHardwareSerial，pro 覆盖层用）─────────────────────
export const getSerialTxInterceptor: any = (): any => null;
