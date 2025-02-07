import { NextResponse } from "next/server";
import { getSortedPosts } from "@/lib/posts";

export async function GET() {
  const posts = getSortedPosts();
  return NextResponse.json(posts);
}
