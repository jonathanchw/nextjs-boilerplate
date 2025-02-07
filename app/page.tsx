"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
  const [posts, setPosts] = useState([]);
  const [activePost, setActivePost] = useState(null);

  useEffect(() => {
    async function fetchPosts() {
      const res = await fetch("/api/posts");
      const data = await res.json();
      setPosts(data);
    }
    fetchPosts();
  }, []);

  const handlePostClick = (slug) => {
    setActivePost(activePost === slug ? null : slug);
  };

  return (
    <main className="max-w-5xl mx-auto py-10 bg-[#fef8ec] min-h-screen relative">
      <h1 className="text-4xl font-bold text-center mb-8 text-[#ff914d]">🐶 Blog de Mascotas</h1>

      <div className={`grid md:grid-cols-2 gap-6 ${activePost ? "blur-sm" : ""}`}>
        {posts.map(({ slug, title, date, description, image }) => (
          <motion.div
            key={slug}
            className="relative bg-white shadow-md p-6 rounded-xl cursor-pointer transition-transform transform hover:scale-105 hover:shadow-lg border border-[#ff914d]"
            onClick={() => handlePostClick(slug)}
            layout
          >
            {image ? (
              <img src={image} alt={title} className="w-full h-48 object-cover rounded-lg mb-4" />
            ) : (
              <div className="w-full h-48 bg-gray-200 flex items-center justify-center rounded-lg mb-4">
                <span className="text-gray-500">📷 Imagen no disponible</span>
              </div>
            )}
            <h2 className="text-xl font-semibold text-[#ff914d]">{title}</h2>
            <p className="text-gray-500 text-sm">{date}</p>
            <p className="mt-2 text-gray-700">{description}</p>
          </motion.div>
        ))}
      </div>

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
              className="bg-white p-6 rounded-xl shadow-2xl max-w-2xl w-full relative overflow-auto"
              style={{
                maxHeight: "90vh",
                margin: "5vh auto",
                borderRadius: "15px",
                scrollbarWidth: "thin",
                scrollbarColor: "#ff914d #f3f3f3"
              }}
            >
              <button className="absolute top-2 right-2 text-xl text-[#ff914d] hover:text-red-600" onClick={() => setActivePost(null)}>✖</button>

              {/* Imagen dentro del modal */}
              {posts.find(post => post.slug === activePost)?.image ? (
                <img
                  src={posts.find(post => post.slug === activePost)?.image}
                  alt="Post"
                  className="w-full h-64 object-cover rounded-lg mb-4"
                />
              ) : (
                <div className="w-full h-64 bg-gray-200 flex items-center justify-center rounded-lg mb-4">
                  <span className="text-gray-500">📷 Imagen no disponible</span>
                </div>
              )}

              <ReactMarkdown className="prose mt-4 text-gray-700">
                {posts.find(post => post.slug === activePost)?.content || "No hay contenido disponible."}
              </ReactMarkdown>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
