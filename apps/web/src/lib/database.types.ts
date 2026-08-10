/** Types for the tables and functions in supabase/migrations.
 *
 *  Written by hand rather than generated, because generating requires a linked
 *  project and this repository has to build without one. Once you have a
 *  project, regenerate instead of editing:
 *
 *    supabase gen types typescript --linked > apps/web/src/lib/database.types.ts
 */

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: { display_name?: string | null };
        Relationships: [];
      };
      saved_churches: {
        Row: {
          user_id: string;
          church_slug: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          church_slug: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      stripe_customers: {
        Row: {
          user_id: string;
          stripe_customer_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string;
          status: string;
          price_id: string | null;
          product_id: string | null;
          quantity: number | null;
          cancel_at_period_end: boolean;
          current_period_start: string | null;
          current_period_end: string | null;
          trial_end: string | null;
          canceled_at: string | null;
          ended_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      account_entitlements: {
        Args: Record<PropertyKey, never>;
        Returns: {
          is_patron: boolean;
          saved_count: number;
          saved_limit: number | null;
        }[];
      };
      has_active_subscription: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      free_saved_church_limit: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
