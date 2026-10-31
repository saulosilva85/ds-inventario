/**
 * Subconjunto dos formatos de resposta da API da AWS usados pelo coletor.
 * Seguem os nomes reais dos campos do AWS SDK v3 (EC2, RDS, S3, ELBv2).
 * Campos opcionais aceitam `undefined` explícito, como no SDK.
 */
export interface RawTag {
  Key?: string | undefined;
  Value?: string | undefined;
}

export interface RawInstance {
  InstanceId?: string | undefined;
  InstanceType?: string | undefined;
  State?: { Name?: string | undefined } | undefined;
  Placement?: { AvailabilityZone?: string | undefined } | undefined;
  PrivateIpAddress?: string | undefined;
  PublicIpAddress?: string | undefined;
  ImageId?: string | undefined;
  VpcId?: string | undefined;
  SubnetId?: string | undefined;
  Architecture?: string | undefined;
  LaunchTime?: Date | undefined;
  Tags?: RawTag[] | undefined;
}

export interface RawVolume {
  VolumeId?: string | undefined;
  Size?: number | undefined;
  VolumeType?: string | undefined;
  State?: string | undefined;
  Encrypted?: boolean | undefined;
  Iops?: number | undefined;
  AvailabilityZone?: string | undefined;
  Attachments?: Array<{ InstanceId?: string | undefined; Device?: string | undefined }> | undefined;
  Tags?: RawTag[] | undefined;
}

export interface RawAddress {
  AllocationId?: string | undefined;
  PublicIp?: string | undefined;
  AssociationId?: string | undefined;
  InstanceId?: string | undefined;
  NetworkInterfaceId?: string | undefined;
  Domain?: string | undefined;
  Tags?: RawTag[] | undefined;
}

export interface RawDbInstance {
  DBInstanceIdentifier?: string | undefined;
  DBInstanceClass?: string | undefined;
  Engine?: string | undefined;
  EngineVersion?: string | undefined;
  DBInstanceStatus?: string | undefined;
  MultiAZ?: boolean | undefined;
  StorageType?: string | undefined;
  AllocatedStorage?: number | undefined;
  StorageEncrypted?: boolean | undefined;
  TagList?: RawTag[] | undefined;
}

export interface RawLoadBalancer {
  LoadBalancerArn?: string | undefined;
  LoadBalancerName?: string | undefined;
  Type?: string | undefined;
  Scheme?: string | undefined;
  State?: { Code?: string | undefined } | undefined;
  DNSName?: string | undefined;
  VpcId?: string | undefined;
  Tags?: RawTag[] | undefined;
}

/** Bucket já combinado com a região (GetBucketLocation) e as tags. */
export interface RawBucket {
  Name?: string | undefined;
  Region?: string | undefined;
  CreationDate?: Date | undefined;
  Tags?: RawTag[] | undefined;
}
