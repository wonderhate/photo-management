import type {FrameDocument} from './core/frame-v2';
import type {SourceDecodeProfile} from './core/source-decode-profile';
export type Filters = Record<string, string>;
export interface PhotoFile {id:string;file_name:string;file_format:string;is_raw:boolean;file_path:string;preview_available:boolean;file_hash?:string}
export interface Photo {
  id:string;file_name:string;file_path:string;capture_group_id:string;file_format:string;is_raw:boolean;
  file_hash?:string;
  decode_profile?:SourceDecodeProfile;
  width:number|null;height:number|null;file_size:number;date_taken:string|null;created_at:string;
  camera_make:string|null;camera_model:string|null;lens_model:string|null;f_number:number|null;
  exposure_time:string|null;exposure_seconds:number|null;iso:number|null;focal_length:number|null;
  focal_length_35mm:number|null;gps_latitude:number|null;gps_longitude:number|null;gps_altitude:number|null;orientation:number|null;
  watermark_draft_count?:number;favorite:boolean;rating:number|null;color_label:string|null;
  rating_source?:import('./core/photo-rating').RatingSource;
  flag?:import('./core/photo-flag').PhotoFlag;
  user_description?:string|null;
  annotation?:import('./core/photo-annotation').PhotoAnnotation|null;
  tag_origins?:Record<string,import('./core/photo-annotation').TagOrigin>;
  rejected_ai_tags?:string[];
  description?:string|null;description_source?:'user'|'ai'|null;
  face_data?:{faces:any[];detected_at:string}|null;
  // Local service URLs or browser library-scoped media references; display through MediaImage/useMediaURL.
  tags:string[];thumbnail_url:string;preview_url:string;thumbnail_path:string|null;
  preview_error:string|null;missing?:boolean;raw_exif?:Record<string,string>;files:PhotoFile[];similarity_score?:number;
  preview_status?:'pending'|'ready'|'failed';
  album_added_at?:string|null;
  preview_source?:'browser'|'embedded-jpeg'|'embedded-bitmap'|'decoded-raw';
}
export interface Album {id:string;person_id?:string|null;name:string;type:'normal'|'smart'|'rule';query?:import('./core/photo-query').PhotoQuery|null;count:number;keywords:string[];match_mode:'all'|'any';threshold:number;max_results:number;ai_model:string|null;cover_id:string|null;created_at?:string;updated_at?:string;cover_mode?:'auto'|'manual';cover_ids?:string[];cover_missing?:boolean;date_from?:string|null;date_to?:string|null;unknown_date_count?:number;last_added_at?:string|null;last_imported_at?:string|null;recent_photo_ids?:string[];recent_kind?:'joined'|'imported'}
export interface Bin {label:string;count:number;percent?:number;filter:Record<string,string|number>}
export interface Summary {total:number;cameras:number;lenses:number;shooting_days:number;shooting_months:number;common_lens:string|null;common_focal:number|null;common_aperture:number|null;common_iso:number|null;common_shutter:string|null;active_day:[string,number]|null;active_month:[string,number]|null;unknown_date:number;files?:number;captures?:number}
export interface Statistics {summary:Summary;charts:Record<string,Bin[]>}
export interface Report extends Statistics {year:number;month:number|null;filters:Record<string,string>;lenses:Bin[];timeline:{period:string;count:number;lenses:Record<string,number>;focal_bands:Record<string,number>;focal_percent:Record<string,number>}[];focal_bands:string[];narratives:string[];zoom:Bin[];cover_id:string|null}
export interface Lifecycle {lens:string;total:number;first_used:string|null;last_used:string|null;past_12_months:number;busiest_month:[string,number]|null;longest_unused_days:number}
export interface ExportResult {sha256?:string;source_sha256?:string;format?:'jpg'|'png'|'webp';metadata_policy?:string;url:string;path?:string;file_name:string;width?:number;height?:number}
export interface Job {id:string;new_photo_ids?:string[];auto_face_analysis?:{status:string;new_count:number;job_id?:string};scope?:{library_id?:string};kind:string;status:string;phase?:'scanning'|'processing'|'previews';total:number;processed:number;success:number;skipped:number;failed:number;current:string;errors:string[];error?:string;results:ExportResult[];parent_id?:string;resource?:string;billable?:boolean;billing_state?:string;billing_uncertain?:boolean;request_id?:string;provider?:string;model?:string;child_count?:number;active_child_id?:string|null;preview_total?:number;preview_processed?:number;preview_failed?:number}
export interface AIStatus {status:string;stage:string;model:string;device:string;available:boolean;processed:number;total:number;indexed:number;failed:number;cached_bytes:number;error:string|null;job_id?:string|null}
export interface Settings {thumbnail_quality:number;count_mode:'capture'|'file';preview_preference:'jpeg'|'raw';export_format:'jpg'|'png'|'webp';export_quality:number;export_long_edge:number;focal_bands:number[];data_dir:string;models_dir:string;exports_dir:string;ai_model:string;scan_paths:string[]}
export interface ScanStatus {paths:string[];job:Job|null}
export interface WatermarkOptions {
  frame_v2?:FrameDocument|null;template:'frame'|'ambient';style:'modern_info_bar'|'classic_frame';show_brand_logo:boolean;info_bar_ratio:number;font_scale:number;fields:string[];signature:string;signature_style:'text'|'natural'|'fine'|'brush'|'calligraphy'|'chinese_brush'|'chinese_running'|'chinese_cursive'|'chinese_handwriting';theme:'white'|'black'|'auto';border:number;info_height:number;font_size:number;align:'left'|'center'|'right';radius:number;blur:number;intensity:number;brightness:number;saturation:number;photo_scale:number;shadow:boolean;format:'jpg'|'png'|'webp';quality:number;long_edge:number;filename_template:string}

export interface WatermarkDraft {
  artwork_id?:string|null;
  asset_variant_id?:string|null;
  id:string;photo_id:string|null;capture_group_id:string|null;name:string;
  watermark_type:string;template_id:string;settings_json:WatermarkOptions;preview_url:string|null;
  status:'draft'|'ready'|'exported';revision:number;created_at:string;updated_at:string;
  last_exported_at:string|null;export_path:string|null;modified_since_export:boolean;source_missing:boolean;
  source:{file_hash?:string;camera_make?:string|null;file_name:string;file_path:string;camera_model:string|null;lens_model:string|null;date_taken:string|null;decode_profile?:SourceDecodeProfile};
}

export interface TimelineYear {
  months: Record<string, {days: Record<string, number>; total: number}>;
  total: number;
}

export interface TimelineData {
  years: Record<string, TimelineYear>;
  unknown_date?:number;
  total?:number;
  count_mode?:'capture'|'file';
}

export interface FacePerson {
  id:string;name:string;photo_count:number;
}

export interface BatchEditPayload {
  user_description?:string|null;
  flag?:import('./core/photo-flag').PhotoFlag;
  photo_ids:string[];
  favorite?:boolean;
  rating?:number;
  color_label?:string;
  add_tags?:string[];
  remove_tags?:string[];
  clear_rating?:boolean;
  clear_color_label?:boolean;
}
