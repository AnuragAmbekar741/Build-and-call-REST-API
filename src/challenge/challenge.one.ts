import { createApiClient } from "../global.client";

/* ---------- types ---------- */
type Post = {
  id: number;
  userId: number;
  title: string;
  body: string;
};

type Comment = {
  id: number;
  postId: number;
  name: string;
  email: string;
  body: string;
};

/* ---------- global client ---------- */
const api = createApiClient({
  baseUrl: "https://jsonplaceholder.typicode.com",
});

/* ---------- fetchers ---------- */
const getPosts = async (): Promise<Post[]> => {
  const res = await api.get<Post[]>("/posts");
  return res.data;
};

const getComments = async (): Promise<Comment[]> => {
  const res = await api.get<Comment[]>("/comments");
  return res.data;
};

/* ---------- main flow ---------- */
async function main() {
  // fetch in parallel (better signal than sequential)
  const [posts, comments] = await Promise.all([getPosts(), getComments()]);

  // map: postId -> comment count
  const commentCountByPost = new Map<number, number>();

  for (const comment of comments) {
    commentCountByPost.set(
      comment.postId,
      (commentCountByPost.get(comment.postId) ?? 0) + 1
    );
  }

  // attach counts to posts
  const postsWithCounts = posts.map((post) => ({
    postId: post.id,
    title: post.title,
    commentCount: commentCountByPost.get(post.id) ?? 0,
  }));

  // top 5 posts by comment count
  const topPosts = postsWithCounts
    .sort((a, b) => b.commentCount - a.commentCount)
    .slice(0, 5);

  console.log("Top 5 posts by comment count:");
  for (const p of topPosts) {
    console.log(`Post ${p.postId}: ${p.commentCount} comments`);
  }
}

/* ---------- entry ---------- */
main().catch((err) => {
  console.error("Failed:", err);
});
