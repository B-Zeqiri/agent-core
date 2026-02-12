import { motion } from 'framer-motion';

function TopBar() {
  return (
    <div className="border-b border-brand-border bg-brand-panel/80 backdrop-blur-2xl px-6 py-4 flex items-center justify-between shadow-xl">
      <motion.h1
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="text-xl font-semibold bg-gradient-to-r from-brand-accent to-blue-400 bg-clip-text text-transparent"
      >
        Agent Core v0.1
      </motion.h1>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.1 }}
        className="text-xs text-brand-muted flex items-center gap-2"
      >
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-brand-success"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [1, 0.5, 1]
          }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        />
        Async Task Execution
      </motion.div>
    </div>
  );
}

export default TopBar;
