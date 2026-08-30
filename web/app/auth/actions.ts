"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildAuthRedirect(type: "error" | "success", message: string) {
  const searchParams = new URLSearchParams({
    [type]: message,
  });

  return `/auth?${searchParams.toString()}`;
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(buildAuthRedirect("error", error.message));
  }

  redirect("/");
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    redirect(buildAuthRedirect("error", error.message));
  }

  if (data.session) {
    redirect("/");
  }

  redirect(
    buildAuthRedirect(
      "success",
      "Compte créé. Vérifiez votre e-mail si la confirmation est activée dans Supabase Auth.",
    ),
  );
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/auth");
}
