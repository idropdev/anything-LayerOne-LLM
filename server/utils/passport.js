const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { User } = require("../models/user");
const prisma = require("./prisma");

// Configure Passport to use Google OAuth2
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GDRIVE_CLIENT_ID,
      clientSecret: process.env.GDRIVE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL}/api/v1/users/google/callback`,
    },
    async (accessToken, refreshToken, params, profile, done) => {
      try {
        // Try to find an existing user by their Google ID
        let user = await User._get({ googleId: profile.id });

        if (!user) {
          // No user yet: create one
          const email = profile.emails?.[0]?.value;
          const base = email ? email.split("@")[0] : `google_${profile.id}`;
          let username = base;
          let suffix = 1;
          // Ensure unique username
          while (await User.count({ username })) {
            username = `${base}${suffix++}`;
          }

          // Direct Prisma create for OAuth users
          user = await prisma.users.create({
            data: {
              username,
              password: "",
              role: "default",
              bio: "",
              dailyMessageLimit: null,
              pfpFilename: null,
              googleId: profile.id,
              accessToken,
              refreshToken,
              tokenExpiryDate: new Date(Date.now() + params.expires_in * 1000),
            },
          });
        } else {
          // Update tokens on existing user
          const { user: updated } = await User._update(user.id, {
            accessToken,
            refreshToken,
            tokenExpiryDate: new Date(Date.now() + params.expires_in * 1000),
          });
          user = updated;
        }

        // Passport require: done(error, user)
        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

// Serialize user ID into the session
passport.serializeUser((user, done) => done(null, user.id));

// Deserialize user by ID from the session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User._get({ id });
    done(null, user || null);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
