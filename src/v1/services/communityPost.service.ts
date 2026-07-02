import { prisma } from '../config/database';
import { CommunityAccessService } from './communityAccess.service';
import { NotificationService } from './notification.service';

const USER_SELECT = { id: true, displayName: true, email: true, avatar: true } as const;

interface ListParams {
    page?: number;
    limit?: number;
}

interface CreatePostData {
    content: string;
    images?: string[];
}

interface CreateCommentData {
    content: string;
}

function mapPost(post: any, userId?: string) {
    return {
        id: post.id,
        communityId: post.communityId,
        author: post.author,
        content: post.content,
        images: post.images,
        commentsCount: post._count.comments,
        likesCount: post._count.likes,
        isLiked: userId ? post.likes.length > 0 : false,
        createdAt: post.createdAt,
    };
}

export class CommunityPostService {
    /**
     * Create a discussion post. Requires the user to be a follower or staff member.
     */
    static async createPost(userId: string, communityId: string, data: CreatePostData) {
        await CommunityAccessService.requireParticipant(userId, communityId);

        const post = await prisma.communityPost.create({
            data: {
                communityId,
                authorId: userId,
                content: data.content,
                images: data.images ?? [],
            },
            include: {
                author: { select: USER_SELECT },
                _count: { select: { comments: true, likes: true } },
                likes: { where: { userId }, select: { id: true } },
            },
        });

        return mapPost(post, userId);
    }

    /**
     * Paginated discussion feed for a community. Public read.
     */
    static async listPosts(communityId: string, userId: string | undefined, params: ListParams) {
        const page = params.page || 1;
        const limit = params.limit || 10;

        const [posts, total] = await Promise.all([
            prisma.communityPost.findMany({
                where: { communityId },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    author: { select: USER_SELECT },
                    _count: { select: { comments: true, likes: true } },
                    likes: userId ? { where: { userId }, select: { id: true } } : false,
                },
            }),
            prisma.communityPost.count({ where: { communityId } }),
        ]);

        return {
            posts: posts.map((post) => mapPost({ ...post, likes: post.likes || [] }, userId)),
            total,
            page,
            totalPages: Math.ceil(total / limit) || 1,
        };
    }

    /**
     * Delete a post. Allowed for the post's author, or an OWNER/ADMIN of the community.
     */
    static async deletePost(userId: string, communityId: string, postId: string) {
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post || post.communityId !== communityId) throw new Error('Post not found');

        if (post.authorId !== userId) {
            await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });
        }

        await prisma.communityPost.delete({ where: { id: postId } });
        return { message: 'Post deleted' };
    }

    /**
     * Like a post. Requires the user to be a follower or staff member.
     */
    static async likePost(userId: string, communityId: string, postId: string) {
        await CommunityAccessService.requireParticipant(userId, communityId);

        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post || post.communityId !== communityId) throw new Error('Post not found');

        try {
            await prisma.communityPostLike.create({ data: { postId, userId } });
            return { message: 'Post liked' };
        } catch (error: any) {
            if (error.code === 'P2002') throw new Error('You already liked this post');
            throw error;
        }
    }

    /**
     * Unlike a post.
     */
    static async unlikePost(userId: string, communityId: string, postId: string) {
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post || post.communityId !== communityId) throw new Error('Post not found');

        const like = await prisma.communityPostLike.findUnique({
            where: { postId_userId: { postId, userId } },
        });
        if (!like) throw new Error('You have not liked this post');

        await prisma.communityPostLike.delete({ where: { postId_userId: { postId, userId } } });
        return { message: 'Post unliked' };
    }

    /**
     * Paginated comments for a post. Public read.
     */
    static async listComments(communityId: string, postId: string, params: ListParams) {
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post || post.communityId !== communityId) throw new Error('Post not found');

        const page = params.page || 1;
        const limit = params.limit || 20;

        const [comments, total] = await Promise.all([
            prisma.communityPostComment.findMany({
                where: { postId },
                orderBy: { createdAt: 'asc' },
                skip: (page - 1) * limit,
                take: limit,
                include: { author: { select: USER_SELECT } },
            }),
            prisma.communityPostComment.count({ where: { postId } }),
        ]);

        return { comments, total, page, totalPages: Math.ceil(total / limit) || 1 };
    }

    /**
     * Add a comment to a post. Requires the user to be a follower or staff member.
     * Notifies the post's author (unless they are the commenter).
     */
    static async addComment(userId: string, communityId: string, postId: string, data: CreateCommentData) {
        await CommunityAccessService.requireParticipant(userId, communityId);

        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post || post.communityId !== communityId) throw new Error('Post not found');

        const comment = await prisma.communityPostComment.create({
            data: { postId, authorId: userId, content: data.content },
            include: { author: { select: USER_SELECT } },
        });

        if (post.authorId !== userId) {
            const [community, commenter] = await Promise.all([
                prisma.community.findUnique({ where: { id: communityId }, select: { name: true, slug: true } }),
                prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
            ]);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

            NotificationService.create({
                userId: post.authorId,
                type: 'COMMUNITY_POST_COMMENT',
                title: `New comment on your post in ${community?.name}`,
                message: `${commenter?.displayName} commented: "${data.content.slice(0, 140)}"`,
                actionUrl: `${frontendUrl}/c/${community?.slug}?post=${postId}`,
            }).catch((err) => console.error('Failed to send community post comment notification:', err));
        }

        return comment;
    }

    /**
     * Delete a comment. Allowed for the comment's author, or an OWNER/ADMIN of the community.
     */
    static async deleteComment(userId: string, communityId: string, postId: string, commentId: string) {
        const comment = await prisma.communityPostComment.findUnique({ where: { id: commentId } });
        if (!comment || comment.postId !== postId) throw new Error('Comment not found');

        if (comment.authorId !== userId) {
            await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });
        }

        await prisma.communityPostComment.delete({ where: { id: commentId } });
        return { message: 'Comment deleted' };
    }
}
