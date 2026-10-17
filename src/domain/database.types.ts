export type Json = string | number | boolean | null | {
    [key: string]: Json | undefined;
} | Json[];
export type Database = {
    "public": {
        Tables: {
            "admins": {
                Row: {
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "user_id": string;
                };
                Update: {
                    "user_id"?: string;
                };
                Relationships: [
                ];
            };
            "club_members": {
                Row: {
                    "active": boolean;
                    "agreement": Json | null;
                    "id": string;
                    "is_test": boolean;
                    "joined_at": string;
                    "leg_id": string;
                    "match_snapshot": Json | null;
                    "monthly_contribution": number;
                    "passenger_id": string;
                    "paused": boolean;
                    "pickup": unknown;
                    "pickup_label": string;
                    "pickup_time": string;
                    "request_id": string | null;
                    "start_date": string;
                };
                ComputedFields: never;
                Insert: {
                    "active"?: boolean;
                    "agreement"?: Json | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "joined_at"?: string;
                    "leg_id": string;
                    "match_snapshot"?: Json | null;
                    "monthly_contribution": number;
                    "passenger_id": string;
                    "paused"?: boolean;
                    "pickup": unknown;
                    "pickup_label": string;
                    "pickup_time": string;
                    "request_id"?: string | null;
                    "start_date": string;
                };
                Update: {
                    "active"?: boolean;
                    "agreement"?: Json | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "joined_at"?: string;
                    "leg_id"?: string;
                    "match_snapshot"?: Json | null;
                    "monthly_contribution"?: number;
                    "passenger_id"?: string;
                    "paused"?: boolean;
                    "pickup"?: unknown;
                    "pickup_label"?: string;
                    "pickup_time"?: string;
                    "request_id"?: string | null;
                    "start_date"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "club_members_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "club_members_passenger_id_fkey";
                        columns: [
                            "passenger_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "club_members_request_id_fkey";
                        columns: [
                            "request_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "join_requests";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "commute_instances": {
                Row: {
                    "completed_at": string | null;
                    "departs_at": string;
                    "driver_arrived_at": string | null;
                    "id": string;
                    "is_test": boolean;
                    "leg_id": string;
                    "service_date": string;
                    "sharing_ends_at": string;
                    "sharing_starts_at": string;
                    "started_at": string | null;
                    "status": Database["public"]["Enums"]["instance_status"];
                };
                ComputedFields: never;
                Insert: {
                    "completed_at"?: string | null;
                    "departs_at": string;
                    "driver_arrived_at"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id": string;
                    "service_date": string;
                    "sharing_ends_at": string;
                    "sharing_starts_at": string;
                    "started_at"?: string | null;
                    "status"?: Database["public"]["Enums"]["instance_status"];
                };
                Update: {
                    "completed_at"?: string | null;
                    "departs_at"?: string;
                    "driver_arrived_at"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id"?: string;
                    "service_date"?: string;
                    "sharing_ends_at"?: string;
                    "sharing_starts_at"?: string;
                    "started_at"?: string | null;
                    "status"?: Database["public"]["Enums"]["instance_status"];
                };
                Relationships: [
                    {
                        foreignKeyName: "commute_instances_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "contributions": {
                Row: {
                    "amount": number;
                    "confirmed_by": string | null;
                    "id": string;
                    "is_test": boolean;
                    "leg_id": string;
                    "paid_at": string | null;
                    "passenger_id": string;
                    "period": string;
                    "report_note": string | null;
                    "reported_at": string | null;
                    "status": Database["public"]["Enums"]["contribution_status"];
                };
                ComputedFields: never;
                Insert: {
                    "amount": number;
                    "confirmed_by"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id": string;
                    "paid_at"?: string | null;
                    "passenger_id": string;
                    "period": string;
                    "report_note"?: string | null;
                    "reported_at"?: string | null;
                    "status"?: Database["public"]["Enums"]["contribution_status"];
                };
                Update: {
                    "amount"?: number;
                    "confirmed_by"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id"?: string;
                    "paid_at"?: string | null;
                    "passenger_id"?: string;
                    "period"?: string;
                    "report_note"?: string | null;
                    "reported_at"?: string | null;
                    "status"?: Database["public"]["Enums"]["contribution_status"];
                };
                Relationships: [
                    {
                        foreignKeyName: "contributions_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "contributions_passenger_id_fkey";
                        columns: [
                            "passenger_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "driver_legs": {
                Row: {
                    "active": boolean;
                    "created_at": string;
                    "days": (number)[];
                    "departure_time": string;
                    "destination": unknown;
                    "destination_label": string;
                    "direction": Database["public"]["Enums"]["leg_direction"];
                    "driver_id": string;
                    "id": string;
                    "is_test": boolean;
                    "max_deviation_min": number;
                    "monthly_contribution": number;
                    "origin": unknown;
                    "origin_label": string;
                    "requests_paused": boolean;
                    "route": unknown;
                    "route_distance_m": number;
                    "route_duration_s": number;
                    "seats_open": number;
                    "leg_signature": string | null;
                };
                ComputedFields: "leg_signature";
                Insert: {
                    "active"?: boolean;
                    "created_at"?: string;
                    "days": (number)[];
                    "departure_time": string;
                    "destination": unknown;
                    "destination_label": string;
                    "direction": Database["public"]["Enums"]["leg_direction"];
                    "driver_id": string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "max_deviation_min"?: number;
                    "monthly_contribution": number;
                    "origin": unknown;
                    "origin_label": string;
                    "requests_paused"?: boolean;
                    "route": unknown;
                    "route_distance_m": number;
                    "route_duration_s": number;
                    "seats_open"?: number;
                };
                Update: {
                    "active"?: boolean;
                    "created_at"?: string;
                    "days"?: (number)[];
                    "departure_time"?: string;
                    "destination"?: unknown;
                    "destination_label"?: string;
                    "direction"?: Database["public"]["Enums"]["leg_direction"];
                    "driver_id"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "max_deviation_min"?: number;
                    "monthly_contribution"?: number;
                    "origin"?: unknown;
                    "origin_label"?: string;
                    "requests_paused"?: boolean;
                    "route"?: unknown;
                    "route_distance_m"?: number;
                    "route_duration_s"?: number;
                    "seats_open"?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: "driver_legs_driver_id_fkey";
                        columns: [
                            "driver_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "instance_riders": {
                Row: {
                    "at_pickup_at": string | null;
                    "collected_at": string | null;
                    "driver_arrived_at": string | null;
                    "instance_id": string;
                    "is_test": boolean;
                    "no_show_at": string | null;
                    "passenger_id": string;
                    "pickup": unknown;
                    "pickup_label": string | null;
                    "pickup_time": string | null;
                    "status": Database["public"]["Enums"]["rider_status"];
                };
                ComputedFields: never;
                Insert: {
                    "at_pickup_at"?: string | null;
                    "collected_at"?: string | null;
                    "driver_arrived_at"?: string | null;
                    "instance_id": string;
                    "is_test"?: boolean;
                    "no_show_at"?: string | null;
                    "passenger_id": string;
                    "pickup"?: unknown;
                    "pickup_label"?: string | null;
                    "pickup_time"?: string | null;
                    "status"?: Database["public"]["Enums"]["rider_status"];
                };
                Update: {
                    "at_pickup_at"?: string | null;
                    "collected_at"?: string | null;
                    "driver_arrived_at"?: string | null;
                    "instance_id"?: string;
                    "is_test"?: boolean;
                    "no_show_at"?: string | null;
                    "passenger_id"?: string;
                    "pickup"?: unknown;
                    "pickup_label"?: string | null;
                    "pickup_time"?: string | null;
                    "status"?: Database["public"]["Enums"]["rider_status"];
                };
                Relationships: [
                    {
                        foreignKeyName: "instance_riders_instance_id_fkey";
                        columns: [
                            "instance_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "commute_instances";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "instance_riders_passenger_id_fkey";
                        columns: [
                            "passenger_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "join_requests": {
                Row: {
                    "agreement": Json | null;
                    "commute_id": string;
                    "created_at": string;
                    "deviation_min": number;
                    "id": string;
                    "is_test": boolean;
                    "leg_id": string;
                    "match_snapshot": Json | null;
                    "monthly_contribution": number;
                    "passenger_id": string;
                    "pickup": unknown;
                    "pickup_label": string;
                    "pickup_time": string;
                    "responded_at": string | null;
                    "route_overlap": number;
                    "start_date": string;
                    "status": Database["public"]["Enums"]["request_status"];
                    "walking_m": number;
                    "walking_min": number;
                };
                ComputedFields: never;
                Insert: {
                    "agreement"?: Json | null;
                    "commute_id": string;
                    "created_at"?: string;
                    "deviation_min": number;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id": string;
                    "match_snapshot"?: Json | null;
                    "monthly_contribution": number;
                    "passenger_id": string;
                    "pickup": unknown;
                    "pickup_label": string;
                    "pickup_time": string;
                    "responded_at"?: string | null;
                    "route_overlap": number;
                    "start_date"?: string;
                    "status"?: Database["public"]["Enums"]["request_status"];
                    "walking_m": number;
                    "walking_min": number;
                };
                Update: {
                    "agreement"?: Json | null;
                    "commute_id"?: string;
                    "created_at"?: string;
                    "deviation_min"?: number;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id"?: string;
                    "match_snapshot"?: Json | null;
                    "monthly_contribution"?: number;
                    "passenger_id"?: string;
                    "pickup"?: unknown;
                    "pickup_label"?: string;
                    "pickup_time"?: string;
                    "responded_at"?: string | null;
                    "route_overlap"?: number;
                    "start_date"?: string;
                    "status"?: Database["public"]["Enums"]["request_status"];
                    "walking_m"?: number;
                    "walking_min"?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: "join_requests_commute_id_fkey";
                        columns: [
                            "commute_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "passenger_commutes";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "join_requests_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "join_requests_passenger_id_fkey";
                        columns: [
                            "passenger_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "location_pings": {
                Row: {
                    "heading": number | null;
                    "id": number;
                    "instance_id": string;
                    "is_test": boolean;
                    "location": unknown;
                    "recorded_at": string;
                    "speed": number | null;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "heading"?: number | null;
                    "id"?: never;
                    "instance_id": string;
                    "is_test"?: boolean;
                    "location": unknown;
                    "recorded_at"?: string;
                    "speed"?: number | null;
                    "user_id": string;
                };
                Update: {
                    "heading"?: number | null;
                    "id"?: never;
                    "instance_id"?: string;
                    "is_test"?: boolean;
                    "location"?: unknown;
                    "recorded_at"?: string;
                    "speed"?: number | null;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "location_pings_instance_id_fkey";
                        columns: [
                            "instance_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "commute_instances";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "location_pings_user_id_fkey";
                        columns: [
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "match_quotes": {
                Row: {
                    "commute_id": string;
                    "commute_signature": string;
                    "created_at": string;
                    "leg_id": string;
                    "leg_signature": string;
                    "match": NonNullable<Json>;
                    "passenger_id": string;
                    "quote_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "commute_id": string;
                    "commute_signature": string;
                    "created_at"?: string;
                    "leg_id": string;
                    "leg_signature": string;
                    "match": NonNullable<Json>;
                    "passenger_id": string;
                    "quote_id"?: string;
                };
                Update: {
                    "commute_id"?: string;
                    "commute_signature"?: string;
                    "created_at"?: string;
                    "leg_id"?: string;
                    "leg_signature"?: string;
                    "match"?: NonNullable<Json>;
                    "passenger_id"?: string;
                    "quote_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "match_quotes_commute_id_fkey";
                        columns: [
                            "commute_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "passenger_commutes";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "match_quotes_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "match_quotes_passenger_id_fkey";
                        columns: [
                            "passenger_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "messages": {
                Row: {
                    "body": string;
                    "created_at": string;
                    "id": string;
                    "is_test": boolean;
                    "leg_id": string;
                    "message_seq": number;
                    "sender_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "body": string;
                    "created_at"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id": string;
                    "message_seq"?: never;
                    "sender_id": string;
                };
                Update: {
                    "body"?: string;
                    "created_at"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id"?: string;
                    "message_seq"?: never;
                    "sender_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "messages_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "messages_sender_id_fkey";
                        columns: [
                            "sender_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "notifications": {
                Row: {
                    "body": string;
                    "created_at": string;
                    "id": string;
                    "is_test": boolean;
                    "kind": string;
                    "link": string | null;
                    "read_at": string | null;
                    "source_document_id": string | null;
                    "source_instance_id": string | null;
                    "source_leg_id": string | null;
                    "source_message_id": string | null;
                    "title": string;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "body": string;
                    "created_at"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind": string;
                    "link"?: string | null;
                    "read_at"?: string | null;
                    "source_document_id"?: string | null;
                    "source_instance_id"?: string | null;
                    "source_leg_id"?: string | null;
                    "source_message_id"?: string | null;
                    "title": string;
                    "user_id": string;
                };
                Update: {
                    "body"?: string;
                    "created_at"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind"?: string;
                    "link"?: string | null;
                    "read_at"?: string | null;
                    "source_document_id"?: string | null;
                    "source_instance_id"?: string | null;
                    "source_leg_id"?: string | null;
                    "source_message_id"?: string | null;
                    "title"?: string;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "notifications_source_document_id_fkey";
                        columns: [
                            "source_document_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "verification_documents";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "notifications_source_instance_id_fkey";
                        columns: [
                            "source_instance_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "commute_instances";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "notifications_source_leg_id_fkey";
                        columns: [
                            "source_leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "notifications_source_message_id_fkey";
                        columns: [
                            "source_message_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "messages";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "notifications_user_id_fkey";
                        columns: [
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "passenger_commutes": {
                Row: {
                    "arrive_by": string;
                    "created_at": string;
                    "days": (number)[];
                    "destination": unknown;
                    "destination_label": string;
                    "direction": Database["public"]["Enums"]["leg_direction"];
                    "end_date": string | null;
                    "id": string;
                    "is_test": boolean;
                    "max_walk_m": number;
                    "notify_on_match": boolean;
                    "origin": unknown;
                    "origin_label": string;
                    "passenger_id": string;
                    "preferred_pickup_id": string | null;
                    "skip_holidays": boolean;
                    "specific_dates": (string)[] | null;
                    "start_date": string;
                    "window_min": number;
                    "commute_signature": string | null;
                };
                ComputedFields: "commute_signature";
                Insert: {
                    "arrive_by": string;
                    "created_at"?: string;
                    "days": (number)[];
                    "destination": unknown;
                    "destination_label": string;
                    "direction"?: Database["public"]["Enums"]["leg_direction"];
                    "end_date"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "max_walk_m"?: number;
                    "notify_on_match"?: boolean;
                    "origin": unknown;
                    "origin_label": string;
                    "passenger_id": string;
                    "preferred_pickup_id"?: string | null;
                    "skip_holidays"?: boolean;
                    "specific_dates"?: (string)[] | null;
                    "start_date"?: string;
                    "window_min"?: number;
                };
                Update: {
                    "arrive_by"?: string;
                    "created_at"?: string;
                    "days"?: (number)[];
                    "destination"?: unknown;
                    "destination_label"?: string;
                    "direction"?: Database["public"]["Enums"]["leg_direction"];
                    "end_date"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "max_walk_m"?: number;
                    "notify_on_match"?: boolean;
                    "origin"?: unknown;
                    "origin_label"?: string;
                    "passenger_id"?: string;
                    "preferred_pickup_id"?: string | null;
                    "skip_holidays"?: boolean;
                    "specific_dates"?: (string)[] | null;
                    "start_date"?: string;
                    "window_min"?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: "passenger_commutes_passenger_id_fkey";
                        columns: [
                            "passenger_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "passenger_commutes_preferred_pickup_id_fkey";
                        columns: [
                            "preferred_pickup_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "pickup_points";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "pickup_changes": {
                Row: {
                    "created_at": string;
                    "id": string;
                    "is_test": boolean;
                    "leg_id": string;
                    "passenger_id": string;
                    "pickup": unknown;
                    "pickup_label": string;
                    "reviewed_at": string | null;
                    "service_date": string;
                    "status": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id": string;
                    "passenger_id": string;
                    "pickup": unknown;
                    "pickup_label": string;
                    "reviewed_at"?: string | null;
                    "service_date": string;
                    "status"?: string;
                };
                Update: {
                    "created_at"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "leg_id"?: string;
                    "passenger_id"?: string;
                    "pickup"?: unknown;
                    "pickup_label"?: string;
                    "reviewed_at"?: string | null;
                    "service_date"?: string;
                    "status"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "pickup_changes_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "pickup_changes_passenger_id_fkey";
                        columns: [
                            "passenger_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "pickup_points": {
                Row: {
                    "area": string;
                    "id": string;
                    "is_test": boolean;
                    "kind": string;
                    "location": unknown;
                    "name": string;
                };
                ComputedFields: never;
                Insert: {
                    "area": string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind"?: string;
                    "location": unknown;
                    "name": string;
                };
                Update: {
                    "area"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind"?: string;
                    "location"?: unknown;
                    "name"?: string;
                };
                Relationships: [
                ];
            };
            "profile_private": {
                Row: {
                    "emergency_contact": string | null;
                    "id": string;
                    "is_test": boolean;
                    "last_name": string | null;
                    "location_consent_at": string | null;
                    "low_data_mode": boolean;
                    "phone": string | null;
                    "terms_accepted_at": string | null;
                };
                ComputedFields: never;
                Insert: {
                    "emergency_contact"?: string | null;
                    "id": string;
                    "is_test"?: boolean;
                    "last_name"?: string | null;
                    "location_consent_at"?: string | null;
                    "low_data_mode"?: boolean;
                    "phone"?: string | null;
                    "terms_accepted_at"?: string | null;
                };
                Update: {
                    "emergency_contact"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "last_name"?: string | null;
                    "location_consent_at"?: string | null;
                    "low_data_mode"?: boolean;
                    "phone"?: string | null;
                    "terms_accepted_at"?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "profile_private_id_fkey";
                        columns: [
                            "id"
                        ];
                        isOneToOne: true;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "profiles": {
                Row: {
                    "about": string | null;
                    "avatar_path": string | null;
                    "completed_arrangements": number;
                    "created_at": string;
                    "deletion_requested_at": string | null;
                    "first_name": string;
                    "id": string;
                    "identity_status": Database["public"]["Enums"]["verification_status"] | null;
                    "is_demo": boolean;
                    "is_test": boolean;
                    "last_initial": string;
                    "onboarding_completed_at": string | null;
                    "rating": number;
                    "rating_count": number;
                    "reliability": number;
                    "role": Database["public"]["Enums"]["user_role"];
                    "suspended_at": string | null;
                    "suspension_reason": string | null;
                };
                ComputedFields: never;
                Insert: {
                    "about"?: string | null;
                    "avatar_path"?: string | null;
                    "completed_arrangements"?: number;
                    "created_at"?: string;
                    "deletion_requested_at"?: string | null;
                    "first_name": string;
                    "id": string;
                    "identity_status"?: Database["public"]["Enums"]["verification_status"] | null;
                    "is_demo"?: boolean;
                    "is_test"?: boolean;
                    "last_initial"?: string;
                    "onboarding_completed_at"?: string | null;
                    "rating"?: number;
                    "rating_count"?: number;
                    "reliability"?: number;
                    "role": Database["public"]["Enums"]["user_role"];
                    "suspended_at"?: string | null;
                    "suspension_reason"?: string | null;
                };
                Update: {
                    "about"?: string | null;
                    "avatar_path"?: string | null;
                    "completed_arrangements"?: number;
                    "created_at"?: string;
                    "deletion_requested_at"?: string | null;
                    "first_name"?: string;
                    "id"?: string;
                    "identity_status"?: Database["public"]["Enums"]["verification_status"] | null;
                    "is_demo"?: boolean;
                    "is_test"?: boolean;
                    "last_initial"?: string;
                    "onboarding_completed_at"?: string | null;
                    "rating"?: number;
                    "rating_count"?: number;
                    "reliability"?: number;
                    "role"?: Database["public"]["Enums"]["user_role"];
                    "suspended_at"?: string | null;
                    "suspension_reason"?: string | null;
                };
                Relationships: [
                ];
            };
            "push_tokens": {
                Row: {
                    "is_test": boolean;
                    "platform": string;
                    "token": string;
                    "updated_at": string;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "is_test"?: boolean;
                    "platform": string;
                    "token": string;
                    "updated_at"?: string;
                    "user_id": string;
                };
                Update: {
                    "is_test"?: boolean;
                    "platform"?: string;
                    "token"?: string;
                    "updated_at"?: string;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "push_tokens_user_id_fkey";
                        columns: [
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "ratings": {
                Row: {
                    "comment": string | null;
                    "created_at": string;
                    "id": string;
                    "instance_id": string | null;
                    "is_test": boolean;
                    "leg_id": string;
                    "ratee_id": string;
                    "rater_id": string;
                    "stars": number;
                    "tags": (string)[];
                };
                ComputedFields: never;
                Insert: {
                    "comment"?: string | null;
                    "created_at"?: string;
                    "id"?: string;
                    "instance_id"?: string | null;
                    "is_test"?: boolean;
                    "leg_id": string;
                    "ratee_id": string;
                    "rater_id": string;
                    "stars": number;
                    "tags"?: (string)[];
                };
                Update: {
                    "comment"?: string | null;
                    "created_at"?: string;
                    "id"?: string;
                    "instance_id"?: string | null;
                    "is_test"?: boolean;
                    "leg_id"?: string;
                    "ratee_id"?: string;
                    "rater_id"?: string;
                    "stars"?: number;
                    "tags"?: (string)[];
                };
                Relationships: [
                    {
                        foreignKeyName: "ratings_instance_id_fkey";
                        columns: [
                            "instance_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "commute_instances";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "ratings_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "ratings_ratee_id_fkey";
                        columns: [
                            "ratee_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "ratings_rater_id_fkey";
                        columns: [
                            "rater_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "reports": {
                Row: {
                    "body": string;
                    "created_at": string;
                    "handled_at": string | null;
                    "handled_by": string | null;
                    "id": string;
                    "instance_id": string | null;
                    "is_test": boolean;
                    "kind": string;
                    "reporter_id": string;
                    "status": Database["public"]["Enums"]["report_status"];
                    "subject_id": string | null;
                };
                ComputedFields: never;
                Insert: {
                    "body": string;
                    "created_at"?: string;
                    "handled_at"?: string | null;
                    "handled_by"?: string | null;
                    "id"?: string;
                    "instance_id"?: string | null;
                    "is_test"?: boolean;
                    "kind": string;
                    "reporter_id": string;
                    "status"?: Database["public"]["Enums"]["report_status"];
                    "subject_id"?: string | null;
                };
                Update: {
                    "body"?: string;
                    "created_at"?: string;
                    "handled_at"?: string | null;
                    "handled_by"?: string | null;
                    "id"?: string;
                    "instance_id"?: string | null;
                    "is_test"?: boolean;
                    "kind"?: string;
                    "reporter_id"?: string;
                    "status"?: Database["public"]["Enums"]["report_status"];
                    "subject_id"?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "reports_instance_id_fkey";
                        columns: [
                            "instance_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "commute_instances";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "reports_reporter_id_fkey";
                        columns: [
                            "reporter_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "reports_subject_id_fkey";
                        columns: [
                            "subject_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "schedule_exceptions": {
                Row: {
                    "created_at": string;
                    "date": string | null;
                    "id": string;
                    "is_test": boolean;
                    "kind": string;
                    "leg_id": string | null;
                    "note": string | null;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "date"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind": string;
                    "leg_id"?: string | null;
                    "note"?: string | null;
                    "user_id": string;
                };
                Update: {
                    "created_at"?: string;
                    "date"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind"?: string;
                    "leg_id"?: string | null;
                    "note"?: string | null;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "schedule_exceptions_leg_id_fkey";
                        columns: [
                            "leg_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "driver_legs";
                        referencedColumns: [
                            "id"
                        ];
                    },
                    {
                        foreignKeyName: "schedule_exceptions_user_id_fkey";
                        columns: [
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "vehicles": {
                Row: {
                    "body_type": string;
                    "colour": string;
                    "driver_id": string;
                    "id": string;
                    "is_test": boolean;
                    "make": string;
                    "model": string;
                    "photo_path": string | null;
                    "registration_summary": string;
                    "seats_total": number;
                    "status": Database["public"]["Enums"]["verification_status"];
                    "year": number | null;
                };
                ComputedFields: never;
                Insert: {
                    "body_type"?: string;
                    "colour": string;
                    "driver_id": string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "make": string;
                    "model": string;
                    "photo_path"?: string | null;
                    "registration_summary": string;
                    "seats_total": number;
                    "status"?: Database["public"]["Enums"]["verification_status"];
                    "year"?: number | null;
                };
                Update: {
                    "body_type"?: string;
                    "colour"?: string;
                    "driver_id"?: string;
                    "id"?: string;
                    "is_test"?: boolean;
                    "make"?: string;
                    "model"?: string;
                    "photo_path"?: string | null;
                    "registration_summary"?: string;
                    "seats_total"?: number;
                    "status"?: Database["public"]["Enums"]["verification_status"];
                    "year"?: number | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "vehicles_driver_id_fkey";
                        columns: [
                            "driver_id"
                        ];
                        isOneToOne: true;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
            "verification_documents": {
                Row: {
                    "created_at": string;
                    "detail": string | null;
                    "expires_on": string | null;
                    "id": string;
                    "is_test": boolean;
                    "kind": Database["public"]["Enums"]["doc_kind"];
                    "review_note": string | null;
                    "reviewed_at": string | null;
                    "reviewed_by": string | null;
                    "status": Database["public"]["Enums"]["verification_status"];
                    "storage_path": string;
                    "submitted_seq": number;
                    "user_id": string;
                };
                ComputedFields: never;
                Insert: {
                    "created_at"?: string;
                    "detail"?: string | null;
                    "expires_on"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind": Database["public"]["Enums"]["doc_kind"];
                    "review_note"?: string | null;
                    "reviewed_at"?: string | null;
                    "reviewed_by"?: string | null;
                    "status"?: Database["public"]["Enums"]["verification_status"];
                    "storage_path": string;
                    "submitted_seq"?: never;
                    "user_id": string;
                };
                Update: {
                    "created_at"?: string;
                    "detail"?: string | null;
                    "expires_on"?: string | null;
                    "id"?: string;
                    "is_test"?: boolean;
                    "kind"?: Database["public"]["Enums"]["doc_kind"];
                    "review_note"?: string | null;
                    "reviewed_at"?: string | null;
                    "reviewed_by"?: string | null;
                    "status"?: Database["public"]["Enums"]["verification_status"];
                    "storage_path"?: string;
                    "submitted_seq"?: never;
                    "user_id"?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "verification_documents_user_id_fkey";
                        columns: [
                            "user_id"
                        ];
                        isOneToOne: false;
                        referencedRelation: "profiles";
                        referencedColumns: [
                            "id"
                        ];
                    }
                ];
            };
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            "account_active": {
                Args: Record<PropertyKey, never>;
                Returns: boolean;
            };
            "admin_update_report": {
                Args: {
                    "p_report": string;
                    "p_status": Database["public"]["Enums"]["report_status"];
                };
                Returns: undefined;
            };
            "advance_test_simulation": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "authorize_match_search": {
                Args: {
                    "p_commute": string;
                    "p_passenger": string;
                };
                Returns: boolean;
            };
            "authorize_pilot_worker": {
                Args: {
                    "p_token": string;
                };
                Returns: boolean;
            };
            "begin_test_trip": {
                Args: {
                    "p_duration_seconds"?: number;
                    "p_request": string;
                };
                Returns: string;
            };
            "bootstrap_account": {
                Args: {
                    "p_full_name": string;
                    "p_role": Database["public"]["Enums"]["user_role"];
                };
                Returns: undefined;
            };
            "can_dispatch_push": {
                Args: {
                    "p_hash": string;
                    "p_id": string;
                    "p_lease": string;
                };
                Returns: boolean;
            };
            "can_receive_location": {
                Args: {
                    "p_topic": string;
                };
                Returns: boolean;
            };
            "can_track": {
                Args: {
                    "p_instance": string;
                };
                Returns: boolean;
            };
            "can_view_test_account": {
                Args: {
                    "p_account": string;
                    "p_viewer"?: string;
                };
                Returns: boolean;
            };
            "can_view_test_instance": {
                Args: {
                    "p_instance": string;
                    "p_viewer"?: string;
                };
                Returns: boolean;
            };
            "can_view_test_leg": {
                Args: {
                    "p_leg": string;
                    "p_viewer"?: string;
                };
                Returns: boolean;
            };
            "cancel_join_request": {
                Args: {
                    "p_request": string;
                };
                Returns: undefined;
            };
            "claim_pilot_work": {
                Args: {
                    "p_push_ready": boolean;
                };
                Returns: Json[];
            };
            "clear_driver_onboarding_draft": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "commute_booked_on": {
                Args: {
                    "c": Omit<Database["public"]["Tables"]["passenger_commutes"]["Row"], Database["public"]["Tables"]["passenger_commutes"]["ComputedFields"]>;
                    "p_date": string;
                };
                Returns: boolean;
            };
            "commute_signature": {
                Args: {
                    "c": Omit<Database["public"]["Tables"]["passenger_commutes"]["Row"], Database["public"]["Tables"]["passenger_commutes"]["ComputedFields"]>;
                };
                Returns: string;
            };
            "complete_instance": {
                Args: {
                    "p_instance": string;
                };
                Returns: undefined;
            };
            "complete_onboarding": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "configure_test_driver": {
                Args: {
                    "p_auto": boolean;
                    "p_decline_percent"?: number;
                    "p_delay"?: number;
                    "p_driver": string;
                };
                Returns: undefined;
            };
            "confirm_contribution": {
                Args: {
                    "p_id": string;
                };
                Returns: undefined;
            };
            "contribution_cap": {
                Args: {
                    "p_days": number;
                    "p_distance_m": number;
                    "p_seats": number;
                };
                Returns: number;
            };
            "delete_my_account": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "driver_approved": {
                Args: {
                    "p_user": string;
                };
                Returns: boolean;
            };
            "driver_verification": {
                Args: {
                    "p_user": string;
                };
                Returns: Json;
            };
            "export_my_data": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "finalize_account_deletion": {
                Args: {
                    "p_job": string;
                    "p_lease": string;
                };
                Returns: undefined;
            };
            "find_matches": {
                Args: {
                    "p_commute": string;
                };
                Returns: Json[];
            };
            "finish_pilot_work": {
                Args: {
                    "p_error"?: string;
                    "p_id": string;
                    "p_kind": string;
                    "p_lease": string;
                };
                Returns: undefined;
            };
            "generate_commute_instances": {
                Args: {
                    "p_date": string;
                };
                Returns: number;
            };
            "generate_contributions": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "get_account_snapshot": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "get_admin_health": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "get_commute_history": {
                Args: Record<PropertyKey, never>;
                Returns: Json[];
            };
            "get_current_instance": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "get_driver_onboarding_draft": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "get_driver_trip_stats": {
                Args: {
                    "p_driver": string;
                };
                Returns: Json;
            };
            "get_estimated_match_quotes": {
                Args: {
                    "p_commute": string;
                };
                Returns: Json;
            };
            "get_match": {
                Args: {
                    "p_commute": string;
                    "p_leg": string;
                };
                Returns: Json;
            };
            "get_my_clubs": {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            "invoke_pilot_worker": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "is_admin": {
                Args: Record<PropertyKey, never>;
                Returns: boolean;
            };
            "is_instance_member": {
                Args: {
                    "p_instance": string;
                };
                Returns: boolean;
            };
            "is_leg_driver": {
                Args: {
                    "p_leg": string;
                };
                Returns: boolean;
            };
            "is_leg_member": {
                Args: {
                    "p_leg": string;
                };
                Returns: boolean;
            };
            "leg_signature": {
                Args: {
                    "l": Omit<Database["public"]["Tables"]["driver_legs"]["Row"], Database["public"]["Tables"]["driver_legs"]["ComputedFields"]>;
                };
                Returns: string;
            };
            "list_chat_summaries": {
                Args: Record<PropertyKey, never>;
                Returns: Json[];
            };
            "list_incoming_requests": {
                Args: Record<PropertyKey, never>;
                Returns: Json[];
            };
            "list_pending_documents": {
                Args: Record<PropertyKey, never>;
                Returns: Json[];
            };
            "list_pickup_changes": {
                Args: Record<PropertyKey, never>;
                Returns: Json[];
            };
            "list_pickup_points": {
                Args: {
                    "p_lat"?: number;
                    "p_lng"?: number;
                    "p_radius_m"?: number;
                };
                Returns: Json[];
            };
            "list_safety_reports": {
                Args: Record<PropertyKey, never>;
                Returns: Json[];
            };
            "mark_club_read": {
                Args: {
                    "p_leg": string;
                    "p_message"?: string;
                };
                Returns: undefined;
            };
            "mark_contribution_paid": {
                Args: {
                    "p_leg": string;
                    "p_passenger": string;
                    "p_period": string;
                };
                Returns: undefined;
            };
            "mark_driver_arrived": {
                Args: {
                    "p_instance": string;
                };
                Returns: undefined;
            } | {
                Args: {
                    "p_instance": string;
                    "p_passenger": string;
                };
                Returns: undefined;
            };
            "mark_rider_status": {
                Args: {
                    "p_instance": string;
                    "p_passenger": string;
                    "p_status": Database["public"]["Enums"]["rider_status"];
                };
                Returns: undefined;
            };
            "match_candidates": {
                Args: {
                    "p_commute": string;
                    "p_passenger": string;
                };
                Returns: Json;
            };
            "notify": {
                Args: {
                    "p_body": string;
                    "p_kind": string;
                    "p_link"?: string;
                    "p_title": string;
                    "p_user": string;
                };
                Returns: undefined;
            };
            "per_day_contribution": {
                Args: {
                    "p_days_per_week": number;
                    "p_monthly": number;
                };
                Returns: number;
            };
            "persist_match_quotes": {
                Args: {
                    "p_commute": string;
                    "p_leg_signatures": Json;
                    "p_matches": Json;
                    "p_passenger": string;
                    "p_signature": string;
                };
                Returns: Json;
            };
            "publish_location": {
                Args: {
                    "p_heading"?: number;
                    "p_instance": string;
                    "p_lat": number;
                    "p_lng": number;
                    "p_speed"?: number;
                };
                Returns: undefined;
            };
            "purge_old_location_pings": {
                Args: Record<PropertyKey, never>;
                Returns: number;
            };
            "queue_commute_reminders": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "reconcile_commutes": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "record_location": {
                Args: {
                    "p_heading"?: number;
                    "p_instance": string;
                    "p_lat": number;
                    "p_lng": number;
                    "p_speed"?: number;
                };
                Returns: undefined;
            };
            "record_push_receipt": {
                Args: {
                    "p_hash": string;
                    "p_id": string;
                    "p_lease": string;
                    "p_provider": string;
                };
                Returns: undefined;
            };
            "register_push_destination": {
                Args: {
                    "p_platform": string;
                    "p_token": string;
                };
                Returns: undefined;
            };
            "remove_member": {
                Args: {
                    "p_leg": string;
                    "p_passenger": string;
                };
                Returns: undefined;
            };
            "report_contribution": {
                Args: {
                    "p_id": string;
                    "p_note"?: string;
                };
                Returns: undefined;
            };
            "request_pickup_change": {
                Args: {
                    "p_date": string;
                    "p_label": string;
                    "p_lat": number;
                    "p_leg": string;
                    "p_lng": number;
                };
                Returns: undefined;
            };
            "request_to_join": {
                Args: {
                    "p_commute": string;
                    "p_leg": string;
                };
                Returns: string;
            };
            "request_to_join_quote": {
                Args: {
                    "p_commute": string;
                    "p_leg": string;
                    "p_quote": string;
                };
                Returns: string;
            };
            "respond_to_request": {
                Args: {
                    "p_accept": boolean;
                    "p_request": string;
                };
                Returns: undefined;
            };
            "review_document": {
                Args: {
                    "p_approve": boolean;
                    "p_doc": string;
                    "p_note"?: string;
                };
                Returns: undefined;
            };
            "review_pickup_change": {
                Args: {
                    "p_approve": boolean;
                    "p_id": string;
                };
                Returns: undefined;
            };
            "run_saved_match_alerts": {
                Args: Record<PropertyKey, never>;
                Returns: undefined;
            };
            "save_driver_onboarding_draft": {
                Args: {
                    "p_draft": Json;
                };
                Returns: undefined;
            };
            "save_driver_settings": {
                Args: {
                    "p_contribution": number;
                    "p_days"?: (number)[];
                    "p_departure"?: string;
                    "p_deviation": number;
                    "p_leg": string;
                    "p_seats": number;
                };
                Returns: undefined;
            };
            "send_club_message": {
                Args: {
                    "p_body": string;
                    "p_leg": string;
                    "p_message": string;
                };
                Returns: Json;
            };
            "set_club_pause": {
                Args: {
                    "p_leg": string;
                    "p_paused": boolean;
                };
                Returns: undefined;
            };
            "set_driver_requests_paused": {
                Args: {
                    "p_leg": string;
                    "p_paused": boolean;
                };
                Returns: undefined;
            };
            "stop_my_sharing": {
                Args: {
                    "p_instance": string;
                };
                Returns: undefined;
            };
            "suggested_contribution": {
                Args: {
                    "p_days": number;
                    "p_distance_m": number;
                    "p_seats": number;
                };
                Returns: number;
            };
            "suspend_account": {
                Args: {
                    "p_reason": string;
                    "p_suspended": boolean;
                    "p_user": string;
                };
                Returns: undefined;
            };
            "test_data_visible": {
                Args: Record<PropertyKey, never>;
                Returns: boolean;
            };
            "upsert_driver_leg": {
                Args: {
                    "p_contribution": number;
                    "p_days": (number)[];
                    "p_departure": string;
                    "p_destination_label": string;
                    "p_destination_lat": number;
                    "p_destination_lng": number;
                    "p_direction": Database["public"]["Enums"]["leg_direction"];
                    "p_distance_m": number;
                    "p_duration_s": number;
                    "p_max_deviation": number;
                    "p_origin_label": string;
                    "p_origin_lat": number;
                    "p_origin_lng": number;
                    "p_route": Json;
                    "p_seats": number;
                };
                Returns: string;
            };
        };
        Enums: {
            "contribution_status": "upcoming" | "due" | "paid" | "overdue";
            "doc_kind": "id" | "licence" | "vehicle_registration" | "insurance" | "profile_photo" | "vehicle_photo";
            "instance_status": "scheduled" | "sharing" | "underway" | "completed" | "cancelled";
            "leg_direction": "to_work" | "to_home";
            "report_status": "open" | "reviewing" | "closed";
            "request_status": "pending" | "accepted" | "declined" | "cancelled";
            "rider_status": "expected" | "absent" | "at_pickup" | "collected" | "no_show" | "dropped_off";
            "user_role": "passenger" | "driver";
            "verification_status": "pending" | "verified" | "rejected";
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
};
type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];
export type Tables<DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]) : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
    Row: infer R;
} ? R : never : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
    Row: infer R;
} ? R : never : never;
export type TablesInsert<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I;
} ? I : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I;
} ? I : never : never;
export type TablesUpdate<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U;
} ? U : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U;
} ? U : never : never;
export type Enums<DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | {
    schema: keyof DatabaseWithoutInternals;
}, EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"] : never = never> = DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName] : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions] : never;
export type CompositeTypes<PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | {
    schema: keyof DatabaseWithoutInternals;
}, CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] : never = never> = PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName] : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions] : never;
export const Constants = {
    "public": {
        Enums: {
            "contribution_status": ["upcoming", "due", "paid", "overdue"],
            "doc_kind": ["id", "licence", "vehicle_registration", "insurance", "profile_photo", "vehicle_photo"],
            "instance_status": ["scheduled", "sharing", "underway", "completed", "cancelled"],
            "leg_direction": ["to_work", "to_home"],
            "report_status": ["open", "reviewing", "closed"],
            "request_status": ["pending", "accepted", "declined", "cancelled"],
            "rider_status": ["expected", "absent", "at_pickup", "collected", "no_show", "dropped_off"],
            "user_role": ["passenger", "driver"],
            "verification_status": ["pending", "verified", "rejected"]
        }
    }
} as const;
