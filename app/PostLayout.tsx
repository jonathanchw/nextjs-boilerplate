"use client";

import { useMemo } from "react";
import Image from "next/image";
import { motion } from "framer-motion";

interface Post {
  slug: string;
  title: string;
  date: string;
  description: string;
  image?: string;
}

interface PostLayoutProps {
  posts: Post[];
  handlePostClick: (slug: string) => void;
  activePost: boolean;
}

const PostLayout: React.FC<PostLayoutProps> = ({ posts, handlePostClick, activePost }) => {
  // 🔥 Mezclamos los posts para aleatoriedad
  const shuffledPosts = useMemo(() => {
    const copy = [...posts];
    copy.sort(() => Math.random() - 0.5);

    // 🔥 Insertamos anuncios después de cada 3 o 5 posts
    const withAds = [];
    for (let i = 0; i < copy.length; i++) {
      withAds.push(copy[i]);
      if ((i + 1) % 3 === 0 || (i + 1) % 5 === 0) {
        withAds.push(null); // Representa un anuncio
      }
    }
    return withAds;
  }, [posts]);

  return (
    <div className={` bg-[#f2f0ed] flex flex-wrap gap-6 ${activePost ? "blur-sm" : ""}`}>
      {/* 🔥 Renderizado de posts y anuncios */}
      {shuffledPosts.map((item, index) =>
        item ? (
          <motion.div
            key={item.slug}
            className={`relative bg-[#f2f0ed] dark:bg-[#6b5652] shadow-md p-6 rounded-xl cursor-pointer
              transition-transform transform hover:scale-105 hover:shadow-lg border border-[#e49b62]
              ${index % 3 === 0 ? "w-full md:w-[48%]" : "w-full md:w-[23%]"}
            `}
            onClick={() => handlePostClick(item.slug)}
            layout
          >
            {item.image ? (
              <div className="relative w-full h-48">
                <Image
                  src={item.image}
                  alt={item.title}
                  fill
                  className="object-cover rounded-lg"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  priority
                />
              </div>
            ) : (
              <div className="w-full h-48 bg-[#a1b56c] flex items-center justify-center rounded-lg mb-4">
                <span className="text-[#91503a]">📷 Imagen no disponible</span>
              </div>
            )}

            <h2 className="text-xl font-semibold text-[#e49b62] dark:text-[#a1b56c]">
              {item.title}
            </h2>
            <p className="text-[#91503a] text-sm dark:text-[#f2f0ed]">{item.date}</p>
            <p className="mt-2 text-[#6b5652] dark:text-[#f2f0ed]">{item.description}</p>
          </motion.div>
        ) : (
          <div
            key={`ad-${index}`}
            className="w-full md:w-[23%] p-6 rounded-xl shadow-md flex items-center justify-center"
          >
            <p className="text-center font-semibold text-[#6b5652]">Anuncio</p>
          </div>
        )
      )}
    </div>
  );
};

export default PostLayout;
