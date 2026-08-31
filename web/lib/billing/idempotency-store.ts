import type { IdempotencyStore } from "billing-stripe-kit";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export function createSupabaseIdempotencyStore(): IdempotencyStore {
  return {
    async has(eventId: string): Promise<boolean> {
      const supabaseAdmin = createSupabaseServiceRoleClient();
      const { data, error } = await supabaseAdmin
        .from("processed_stripe_events")
        .select("event_id")
        .eq("event_id", eventId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data !== null;
    },

    async record(eventId: string): Promise<void> {
      const supabaseAdmin = createSupabaseServiceRoleClient();
      const { error } = await supabaseAdmin
        .from("processed_stripe_events")
        .upsert({ event_id: eventId }, { onConflict: "event_id", ignoreDuplicates: true });

      if (error) {
        throw error;
      }
    },
  };
}
