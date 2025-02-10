"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useTheme } from "next-themes";
import PostLayout from "./PostLayout";


export default function Home() {
  const { theme, setTheme } = useTheme();

  type Post = {
    slug: string;
    title: string;
    date: string;
    description: string;
    image?: string;
    content: string;
  };

  const [posts, setPosts] = useState<Post[]>([]);
  const [activePost, setActivePost] = useState<string | null>(null);


  useEffect(() => {
    async function fetchPosts() {
      const res = await fetch("/api/posts");
      const data = await res.json();
      setPosts(data);
    }
    fetchPosts();
  }, []);

  const handlePostClick = (slug: string) => {
    setActivePost(activePost === slug ? null : slug);
  };

  const activePostData = posts.find((post) => post.slug === activePost);
  return (
    <main className="max-w-none px-4 md:px-8 lg:px-20 py-10 min-h-screen relative">
      <div className="flex justify-between items-center mb-8 px-4">
        <div className="flex items-center space-x-3">
          <Image
            src="/images/logomascotafelizshop64x64.png"
            alt="Logo"
            width={50}
            height={50}
            className="rounded-full"
          />
          <h1 className="text-4xl font-bold text-[#e49b62]">Mascota Feliz Shop</h1>
        </div>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="px-4 py-2 bg-[#f2f0ed] dark:bg-[#6b5652] rounded-lg shadow text-[#91503a] dark:text-[#e49b62]"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>
      <PostLayout posts={posts} handlePostClick={handlePostClick} activePost={!!activePost} />
      {/* Modal de post activo */}
      <AnimatePresence>
        {activePost && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"
            onClick={() => setActivePost(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-[#f2f0ed] dark:bg-[#6b5652] p-6 rounded-xl shadow-2xl max-w-2xl w-full relative overflow-auto"
              style={{
                maxHeight: "90vh",
                margin: "5vh auto",
                borderRadius: "15px",
                scrollbarWidth: "thin",
                scrollbarColor: "#e49b62 #f3f3f3",
              }}
            >
              <button
                className="absolute top-2 right-2 text-[#e49b62] dark:text-[#a1b56c] hover:text-red-600"
                onClick={() => setActivePost(null)}
              >
                ✖
              </button>

              {/* Imagen en el modal */}
              {activePostData?.image ? (
                <div className="relative w-full h-64">
                  <Image
                    src={activePostData.image}
                    alt="Post"
                    width={600}
                    height={256}
                    className="w-full h-64 object-cover rounded-lg mb-4"
                    priority
                  />
                </div>
              ) : (
                <div className="w-full h-64 bg-[#a1b56c] flex items-center justify-center rounded-lg mb-4">
                  <span className="text-[#91503a]">📷 Imagen no disponible</span>
                </div>
              )}

              <ReactMarkdown className="prose mt-4 text-[#6b5652] dark:text-[#f2f0ed]">
                {posts.find((post) => post.slug === activePost)?.content ||
                  "No hay contenido disponible."}
              </ReactMarkdown>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Analytics />
      <SpeedInsights />
    </main>

  );
}
