export type AccessToken = {
  token: string;
  expiresOnTimestamp: number;
  refreshAfterTimestamp?: number;
  tokenType?: string;
};

export type GetTokenOptions = {
  abortSignal?: AbortSignal;
  claims?: string;
  tenantId?: string;
  enableCae?: boolean;
  [key: string]: unknown;
};

export type TokenCredential = {
  getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken | null>;
};

export type AutoSuspendMode = 'Memory' | 'Disk';
export type EgressAction = 'Allow' | 'Deny';
export type VolumeType = 'AzureBlob' | 'DataDisk' | 'AzureBlobByo';

export type DataPlaneClientOptions = {
  credential: TokenCredential;
  region?: string;
  endpoint?: string;
  audience?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
};

export type SandboxGroupClientOptions = DataPlaneClientOptions & {
  subscriptionId: string;
  resourceGroup: string;
  sandboxGroup: string;
};

export type SandboxClientOptions = SandboxGroupClientOptions & {
  sandboxId: string;
};

export type SandboxGroupManagementClientOptions = {
  credential: TokenCredential;
  subscriptionId: string;
  resourceGroup: string;
  apiVersion?: string;
  fetch?: typeof fetch;
};

export type SandboxGroupClientFromEnvOptions = Partial<
  Pick<SandboxGroupClientOptions, 'subscriptionId' | 'resourceGroup' | 'sandboxGroup' | 'region'>
> &
  Pick<SandboxGroupClientOptions, 'credential'> &
  Pick<SandboxGroupClientOptions, 'endpoint' | 'audience' | 'apiVersion' | 'fetch'>;

export type SandboxGroupManagementClientFromEnvOptions = Partial<
  Pick<SandboxGroupManagementClientOptions, 'subscriptionId' | 'resourceGroup'>
> &
  Pick<SandboxGroupManagementClientOptions, 'credential' | 'apiVersion' | 'fetch'>;

export type SandboxResources = {
  cpu?: string;
  memory?: string;
  disk?: string;
  [key: string]: unknown;
};

export type SandboxSourcesRef = {
  diskImage?: DiskImageRef;
  snapshot?: SnapshotRef;
  [key: string]: unknown;
};

export type DiskImageRef = {
  id?: string;
  name?: string;
  isPublic?: boolean;
  [key: string]: unknown;
};

export type SnapshotRef = {
  id?: string;
  [key: string]: unknown;
};

export type Sandbox = {
  id: string;
  state?: string;
  labels?: Record<string, string>;
  environment?: Record<string, string>;
  resources?: SandboxResources;
  sourcesRef?: SandboxSourcesRef;
  lifecycle?: LifecyclePolicy;
  ports?: SandboxPort[];
  egressPolicy?: EgressPolicy;
  [key: string]: unknown;
};

export type CreateSandboxOptions = {
  disk?: string;
  diskId?: string;
  snapshotId?: string;
  preset?: string;
  cpu?: string;
  memory?: string;
  diskSize?: string;
  autoSuspendSeconds?: number;
  autoSuspendMode?: AutoSuspendMode;
  labels?: Record<string, string>;
  environment?: Record<string, string>;
  connections?: string[];
  egressPolicy?: EgressPolicy;
  volumes?: SandboxVolume[];
  ports?: Array<AddPortRequest | number>;
  entrypoint?: string[];
  cmd?: string[];
  skipEgressProxy?: boolean;
  customerVnetConnectionName?: string;
  vmmType?: string;
};

export type ListSandboxesOptions = {
  labels?: Record<string, string>;
};

export type ExecOptions = {
  workingDirectory?: string;
  check?: boolean;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  [key: string]: unknown;
};

export type AutoSuspendPolicy = {
  enabled?: boolean;
  interval?: number;
  mode?: AutoSuspendMode;
  [key: string]: unknown;
};

export type AutoDeletePolicy = {
  enabled?: boolean;
  deleteIntervalSeconds?: number;
  [key: string]: unknown;
};

export type LifecyclePolicy = {
  autoSuspend?: AutoSuspendPolicy;
  autoDelete?: AutoDeletePolicy;
  [key: string]: unknown;
};

export type PortAuthEntraId = {
  enabled?: boolean;
  emails?: string[];
  [key: string]: unknown;
};

export type PortAuthConfig = {
  anonymous?: boolean;
  entraId?: PortAuthEntraId;
  [key: string]: unknown;
};

export type PortIpAccessControlRule = {
  name: string;
  action: EgressAction;
  priority: number;
  sourceCidrs: string[];
};

export type PortIpAccessControl = {
  defaultAction: EgressAction;
  rules?: PortIpAccessControlRule[];
};

export type AddPortRequest = {
  port: number;
  auth?: PortAuthConfig;
  ipAccessControl?: PortIpAccessControl;
  [key: string]: unknown;
};

export type SandboxPort = AddPortRequest & {
  url?: string;
  targetPort?: number;
};

export type FileInfo = {
  name?: string;
  path?: string;
  size?: number;
  isDirectory?: boolean;
  modifiedTime?: string;
  [key: string]: unknown;
};

export type DirListing = {
  entries?: FileInfo[];
  [key: string]: unknown;
};

export type FileOperationOptions = {
  containerName?: string;
};

export type WriteFileOptions = FileOperationOptions & {
  createDirs?: boolean;
  mode?: string;
};

export type DeleteFileOptions = FileOperationOptions & {
  recursive?: boolean;
};

export type CpuUsage = {
  [key: string]: unknown;
};

export type NetworkUsage = {
  [key: string]: unknown;
};

export type ResourceUsage = {
  [key: string]: unknown;
};

export type SandboxStats = {
  cpu?: CpuUsage;
  network?: NetworkUsage;
  resources?: ResourceUsage;
  [key: string]: unknown;
};

export type DiskImageStatus = {
  state?: string;
  [key: string]: unknown;
};

export type DiskImage = {
  id: string;
  name?: string;
  labels?: Record<string, string>;
  status?: DiskImageStatus;
  [key: string]: unknown;
};

export type PublicDiskImage = {
  name: string;
  [key: string]: unknown;
};

export type RegistryCredentials = {
  server?: string;
  username?: string;
  passwordSecretRef?: string;
  [key: string]: unknown;
};

export type CreateDiskImageOptions = {
  name?: string;
  entrypoint?: string[];
  cmd?: string[];
  registryCredentials?: RegistryCredentials;
  managedIdentityResourceId?: string;
};

export type SnapshotResources = {
  [key: string]: unknown;
};

export type Snapshot = {
  id: string;
  name?: string;
  state?: string;
  resources?: SnapshotResources;
  labels?: Record<string, string>;
  [key: string]: unknown;
};

export type AzureBlobByoManagedIdentityAuth = {
  type?: string;
  managedIdentityResourceId?: string;
  [key: string]: unknown;
};

export type SandboxGroupIdentitySelector = {
  [key: string]: unknown;
};

export type VolumeUsage = {
  [key: string]: unknown;
};

export type Volume = {
  name?: string;
  id?: string;
  type?: VolumeType;
  labels?: Record<string, string>;
  usage?: VolumeUsage;
  [key: string]: unknown;
};

export type SandboxVolume = {
  name?: string;
  mountPath?: string;
  [key: string]: unknown;
};

export type AddVolumeMountRequest = {
  name: string;
  mountPath: string;
  [key: string]: unknown;
};

export type CreateVolumeOptions = {
  size?: string;
  type?: VolumeType;
  labels?: Record<string, string>;
  storageContainerResourceId?: string;
  auth?: AzureBlobByoManagedIdentityAuth;
};

export type SecretMetadata = {
  id?: string;
  name?: string;
  keys?: string[];
  [key: string]: unknown;
};

export type SecretValuePeek = {
  values?: Record<string, string>;
  [key: string]: unknown;
};

export type EgressHeaderValueRef = {
  secretRef?: string;
  key?: string;
  [key: string]: unknown;
};

export type EgressHeader = {
  name: string;
  value?: string;
  valueRef?: EgressHeaderValueRef;
  [key: string]: unknown;
};

export type EgressHostRule = {
  pattern: string;
  action: EgressAction;
  [key: string]: unknown;
};

export type EgressRuleMatch = {
  host?: string;
  path?: string;
  methods?: string[];
  [key: string]: unknown;
};

export type EgressRuleAction = {
  type: 'Transform' | 'Rewrite' | string;
  headers?: EgressHeader[];
  host?: string;
  path?: string;
  scheme?: string;
  [key: string]: unknown;
};

export type EgressRule = {
  name?: string;
  match?: EgressRuleMatch;
  action?: EgressRuleAction;
  [key: string]: unknown;
};

export type EgressPolicy = {
  defaultAction?: EgressAction;
  hostRules?: EgressHostRule[];
  rules?: EgressRule[];
  [key: string]: unknown;
};

export type EgressDecisionEntry = {
  [key: string]: unknown;
};

export type EgressDecisions = {
  decisions?: EgressDecisionEntry[];
  [key: string]: unknown;
};

export type SandboxGroup = {
  id?: string;
  name?: string;
  type?: string;
  location?: string;
  tags?: Record<string, string>;
  identity?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

export type CreateSandboxGroupOptions = {
  identity?: Record<string, unknown>;
  tags?: Record<string, string>;
  properties?: Record<string, unknown>;
};
